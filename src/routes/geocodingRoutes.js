const express = require("express");
const axios = require("axios");
const router = express.Router();

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
  10115: { city: "Berlin", country: "Germany" },
  80331: { city: "Munich", country: "Germany" },
  20095: { city: "Hamburg", country: "Germany" },
  50667: { city: "Cologne", country: "Germany" },
  60308: { city: "Frankfurt", country: "Germany" },
  55116: { city: "Mainz", country: "Germany" },

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

router.get("/postal-code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const detectedCountry = detectCountryCode(code);

    console.log(
      `Geocoding request for postal code: ${code}, detected country: ${detectedCountry}`
    );

    // First, try simple mapping
    if (postalCodeMapping[code]) {
      const location = postalCodeMapping[code];
      const locationInfo = {
        city: location.city,
        state: null,
        country: location.country,
        district: null,
        suburb: null,
        borough: null,
        cityDistrict: null,
        displayName: `${location.city}, ${location.country}`,
        latitude: null,
        longitude: null,
        rawAddress: null,
      };

      return res.json(locationInfo);
    }

    // Enhanced Nominatim query with more detailed address components
    try {
      console.log(
        `Trying enhanced Nominatim for ${code} with country ${detectedCountry}`
      );

      const response = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
          params: {
            postalcode: code,
            countrycodes: detectedCountry.toLowerCase(),
            format: "json",
            limit: 1,
            addressdetails: 1,
            extratags: 1, // Get additional tags
            namedetails: 1, // Get name details in multiple languages
          },
          headers: {
            "User-Agent": "Lomir-App/1.0",
          },
          timeout: 5000,
        }
      );

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        const address = result.address;

        console.log("Full address data:", JSON.stringify(address, null, 2));

        const locationInfo = {
          // Basic location
          city:
            address.city ||
            address.town ||
            address.village ||
            address.municipality,
          state: address.state,
          country: address.country,

          // Detailed location components
          district: address.city_district || address.district || address.suburb,
          suburb: address.suburb || address.neighbourhood,
          borough: address.borough,
          cityDistrict: address.city_district,

          // Coordinates
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),

          // Display names
          displayName: this.formatEnhancedDisplayName(address),

          // Raw data for debugging
          rawAddress: address,

          // Additional metadata
          importance: result.importance,
          osmType: result.osm_type,
        };

        console.log(
          `Enhanced geocoding success for ${code}:`,
          locationInfo.displayName
        );
        return res.json(locationInfo);
      }
    } catch (nominatimError) {
      console.log(
        `Enhanced Nominatim failed for ${code}:`,
        nominatimError.message
      );
    }

    // Fallback response
    res.json({
      city: null,
      state: null,
      country: null,
      district: null,
      suburb: null,
      borough: null,
      cityDistrict: null,
      displayName: code,
      latitude: null,
      longitude: null,
      rawAddress: null,
    });
  } catch (error) {
    console.error("Enhanced geocoding service error:", error.message);
    res.json({
      city: null,
      state: null,
      country: null,
      district: null,
      suburb: null,
      borough: null,
      cityDistrict: null,
      displayName: req.params.code,
      latitude: null,
      longitude: null,
      rawAddress: null,
    });
  }
});

function formatEnhancedDisplayName(address) {
  const components = [];

  // Add the most specific location first
  if (address.city_district) {
    components.push(address.city_district);
  } else if (address.district) {
    components.push(address.district);
  } else if (address.suburb) {
    components.push(address.suburb);
  } else if (address.neighbourhood) {
    components.push(address.neighbourhood);
  }

  // Add city
  const city =
    address.city || address.town || address.village || address.municipality;
  if (city) {
    components.push(city);
  }

  // Add country
  if (address.country) {
    components.push(address.country);
  }

  return components.length > 0 ? components.join(", ") : "";
}

module.exports = router;
