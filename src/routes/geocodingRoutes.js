const express = require("express");
const axios = require("axios");
const { deriveLocationFromPostalCode } = require("../utils/locationDerivation");
const { geocodingLimiter } = require("../middlewares/rateLimiter");
const router = express.Router();

// In-memory cache for postal-code lookups. Reduces duplicate outbound calls to
// the Nominatim (OSM) service for repeated postal codes, which both respects
// their usage policy and limits how often user-entered locations leave the
// server. Entries expire after the TTL; the map is bounded to cap memory use.
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GEOCODE_CACHE_MAX_ENTRIES = 1000;
const geocodeCache = new Map();

function getCachedLocation(key) {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedLocation(key, value) {
  // Evict the oldest entry once the cache is full (Map preserves insertion order).
  if (geocodeCache.size >= GEOCODE_CACHE_MAX_ENTRIES) {
    const oldestKey = geocodeCache.keys().next().value;
    geocodeCache.delete(oldestKey);
  }
  geocodeCache.set(key, {
    value,
    expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
  });
}

// Helper function to detect country from postal code
function detectCountryCode(postalCode) {
  if (!postalCode) return "DE";

  const code = postalCode.toString().trim();

  if (/^\d{5}$/.test(code)) return "DE"; // German: 12345
  if (/^\d{4}$/.test(code)) return "NL"; // Dutch: 1234
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(code)) return "GB"; // UK: SW1A 1AA
  if (/^\d{2}-\d{3}$/.test(code)) return "PL"; // Polish: 12-345
  if (/^\d{5}-\d{3}$/.test(code)) return "PT"; // Portuguese: 12345-123
  if (/^\d{3}\s\d{2}$/.test(code)) return "SE"; // Swedish: 123 45

  return "DE"; // Default fallback
}

// Simple postal code to city mapping for common European codes
const postalCodeMapping = {
  // Germany
  10115: { city: "Berlin", state: "Berlin", country: "Germany", district: "Mitte" },
  12555: { city: "Berlin", state: "Berlin", country: "Germany", district: "Köpenick" },
  80331: { city: "Munich", state: "Bavaria", country: "Germany", district: "Altstadt-Lehel" },
  20095: { city: "Hamburg", state: "Hamburg", country: "Germany", district: "Hamburg-Altstadt" },
  50667: { city: "Cologne", state: "North Rhine-Westphalia", country: "Germany", district: "Innenstadt" },
  60308: { city: "Frankfurt am Main", state: "Hessen", country: "Germany", district: "Westend-Süd" },
  55116: { city: "Mainz", state: "Rhineland-Palatinate", country: "Germany", district: "Altstadt" },

  // Netherlands
  1012: { city: "Amsterdam", country: "Netherlands" },
  3011: { city: "Rotterdam", country: "Netherlands" },
  2511: { city: "The Hague", country: "Netherlands" },
  3511: { city: "Utrecht", country: "Netherlands" },

  // UK
  "SW1A 1AA": { city: "London", country: "United Kingdom" },
  "M1 1AA": { city: "Manchester", country: "United Kingdom" },
  "B1 1AA": { city: "Birmingham", country: "United Kingdom" },
  "EH1 1AA": { city: "Edinburgh", country: "United Kingdom" },
  "BS1 1AA": { city: "Bristol", country: "United Kingdom" },
  "CF10 1AA": { city: "Cardiff", country: "United Kingdom" },

  // Poland
  "80-001": { city: "Gdansk", country: "Poland" },
  "00-001": { city: "Warsaw", country: "Poland" },
  "30-001": { city: "Krakow", country: "Poland" },

  // Other European cities
  75001: { city: "Paris", country: "France" },
  28001: { city: "Madrid", country: "Spain" },
  "00100": { city: "Rome", country: "Italy" },
  1000: { city: "Brussels", country: "Belgium" },
  8001: { city: "Zurich", country: "Switzerland" },
  1010: { city: "Vienna", country: "Austria" },
  1050: { city: "Copenhagen", country: "Denmark" },
  "0150": { city: "Oslo", country: "Norway" },
  "111 29": { city: "Stockholm", country: "Sweden" },
  "110 00": { city: "Prague", country: "Czech Republic" },
};

router.get("/postal-code/:code", geocodingLimiter, async (req, res) => {
  try {
    const { code } = req.params;
    const requestedCountry = req.query.country || null;
    const detectedCountry = requestedCountry || detectCountryCode(code);

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `Geocoding request for postal code: ${code}, detected country: ${detectedCountry}`
      );
    }

    const cacheKey = `${code}|${detectedCountry}`;
    const cachedLocation = getCachedLocation(cacheKey);
    if (cachedLocation) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Cache hit for ${cacheKey}`);
      }
      return res.json(cachedLocation);
    }

    const derivedLocation = deriveLocationFromPostalCode(code, detectedCountry);
    const mappedLocation = postalCodeMapping[code];

    // First, try our deterministic mapping
    if (derivedLocation.city || mappedLocation) {
      const location = {
        ...mappedLocation,
        ...derivedLocation,
      };
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `Found in mapping: ${code} -> ${location.city}, ${location.country}`
        );
      }

      const district =
        location.district ||
        location.suburb ||
        location.borough ||
        location.cityDistrict ||
        null;
      const locationInfo = {
        city: location.city,
        state: location.state || null,
        country: location.country,
        district,
        suburb: location.suburb || null,
        borough: location.borough || null,
        cityDistrict: location.cityDistrict || null,
        displayName: [district, location.city, location.country]
          .filter(Boolean)
          .join(", "),
        latitude: null,
        longitude: null,
      };

      setCachedLocation(cacheKey, locationInfo);
      return res.json(locationInfo);
    }

    // If not in mapping, try Nominatim with proper country code
    let nominatimErrored = false;
    try {
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `Trying Nominatim for ${code} with country ${detectedCountry}`
        );
      }

      const response = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
          params: {
            postalcode: code,
            countrycodes: detectedCountry.toLowerCase(),
            format: "json",
            limit: 1,
            addressdetails: 1,
          },
          headers: {
            "User-Agent": "Lomir-App/1.0",
          },
          timeout: 5000, // 5 second timeout
        }
      );

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        const address = result.address;

        const locationInfo = {
          city:
            address.city || address.town || address.village || address.hamlet,
          state: address.state,
          country: address.country,
          district:
            address.city_district ||
            address.suburb ||
            address.quarter ||
            address.neighbourhood ||
            address.borough ||
            null,
          suburb: address.suburb || null,
          borough: address.borough || null,
          cityDistrict: address.city_district || null,
          displayName: formatDisplayName(address),
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          importance: result.importance,
          osmType: result.osm_type,
          rawAddress: address,
        };

        if (process.env.NODE_ENV !== "production") {
          console.log(`Nominatim success for ${code}:`, locationInfo.displayName);
        }
        setCachedLocation(cacheKey, locationInfo);
        return res.json(locationInfo);
      }
    } catch (nominatimError) {
      nominatimErrored = true;
      if (process.env.NODE_ENV !== "production") {
        console.log(`Nominatim failed for ${code}:`, nominatimError.message);
      }
    }

    // If both methods fail, return a basic response
    if (process.env.NODE_ENV !== "production") {
      console.log(`No geocoding results found for postal code: ${code}`);
    }
    const fallbackLocation = {
      city: null,
      state: null,
      country: null,
      displayName: code, // Just show the postal code
      latitude: null,
      longitude: null,
    };
    // Cache a definitive "no result" (Nominatim returned nothing), but never a
    // transient failure (timeout/error), so lookups can succeed once it recovers.
    if (!nominatimErrored) {
      setCachedLocation(cacheKey, fallbackLocation);
    }
    res.json(fallbackLocation);
  } catch (error) {
    console.error("Geocoding service error:", error.message);

    // Return postal code as fallback
    res.json({
      city: null,
      state: null,
      country: null,
      displayName: req.params.code,
      latitude: null,
      longitude: null,
    });
  }
});

function formatDisplayName(address) {
  const city =
    address.city || address.town || address.village || address.hamlet;
  const country = address.country;

  if (city && country) {
    return `${city}, ${country}`;
  } else if (city) {
    return city;
  } else if (country) {
    return country;
  }
  return "";
}

module.exports = router;
