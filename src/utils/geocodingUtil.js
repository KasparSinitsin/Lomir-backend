/**
 * Geocoding Utility
 * Converts postal code + country to latitude/longitude coordinates AND state/region
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 */

const axios = require("axios");
const { deriveLocationFromPostalCode } = require("./locationDerivation");

// Country code to country name mapping for Nominatim
const COUNTRY_CODES = {
  DE: "Germany",
  AT: "Austria",
  CH: "Switzerland",
  NL: "Netherlands",
  BE: "Belgium",
  FR: "France",
  GB: "United Kingdom",
  IT: "Italy",
  ES: "Spain",
  PL: "Poland",
  CZ: "Czech Republic",
  DK: "Denmark",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  US: "United States",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  MX: "Mexico",
  ZA: "South Africa",
  PT: "Portugal",
  IE: "Ireland",
  GR: "Greece",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  HR: "Croatia",
  SK: "Slovakia",
  SI: "Slovenia",
  LT: "Lithuania",
  LV: "Latvia",
  EE: "Estonia",
  LU: "Luxembourg",
  // Add more as needed
};

/**
 * Extract state/region from Nominatim address response
 * @param {Object} address - Nominatim address object
 * @returns {string|null} State/region name or null
 */
function extractState(address) {
  if (!address) return null;

  // Nominatim returns state in different fields depending on the country
  // Priority: state > county > region > state_district
  return (
    address.state ||
    address.county ||
    address.region ||
    address.state_district ||
    null
  );
}

function normalizeLocationValue(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function extractCity(address) {
  if (!address) return null;

  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.locality ||
    null
  );
}

function extractDistrict(address) {
  if (!address) return null;

  return (
    address.city_district ||
    address.suburb ||
    address.quarter ||
    address.neighbourhood ||
    address.borough ||
    address.district ||
    null
  );
}

function getCountryName(country) {
  const normalizedCountry = normalizeLocationValue(country);
  if (!normalizedCountry) return null;
  const upperCountry = normalizedCountry.toUpperCase();
  return COUNTRY_CODES[upperCountry] || normalizedCountry;
}

function mergeAddressDetails(baseLocation, address = {}) {
  return {
    ...baseLocation,
    city: baseLocation.city || extractCity(address),
    state: baseLocation.state || extractState(address),
    district: baseLocation.district || extractDistrict(address),
    country: baseLocation.country || address.country_code?.toUpperCase() || address.country,
  };
}

function buildSearchQuery({ postal_code, city, district, country }) {
  const countryName = getCountryName(country);
  const queryParts = [];

  if (postal_code) queryParts.push(postal_code);
  if (district && district !== city) queryParts.push(district);
  if (city) queryParts.push(city);
  if (countryName) queryParts.push(countryName);

  return queryParts.join(", ");
}

async function fetchFirstNominatimResult(params) {
  const response = await axios.get(
    "https://nominatim.openstreetmap.org/search",
    {
      params: {
        format: "json",
        limit: 1,
        addressdetails: 1,
        ...params,
      },
      headers: {
        "User-Agent": "Lomir-App/1.0 (team-building-app)",
      },
      timeout: 10000,
    },
  );

  return response.data && response.data.length > 0 ? response.data[0] : null;
}

async function resolveLocationData(locationData = {}) {
  const postal_code = normalizeLocationValue(locationData.postal_code);
  const city = normalizeLocationValue(locationData.city);
  const state = normalizeLocationValue(locationData.state);
  const district = normalizeLocationValue(locationData.district);
  const country = normalizeLocationValue(locationData.country);

  if (!country) {
    if (process.env.NODE_ENV !== "production") {
      console.log("Geocoding skipped: No country provided");
    }
    return null;
  }

  const derivedLocation = deriveLocationFromPostalCode(postal_code, country);
  const resolved = {
    postal_code,
    city: city || derivedLocation.city || null,
    state: state || derivedLocation.state || null,
    district: district || derivedLocation.district || null,
    country,
    latitude: null,
    longitude: null,
  };

  const countryName = getCountryName(country);

  try {
    const searchQuery = buildSearchQuery(resolved);

    if (process.env.NODE_ENV !== "production") {
      console.log(`Geocoding location: "${searchQuery || countryName}"`);
    }

    const attempts = [];

    if (postal_code || resolved.city || resolved.district) {
      attempts.push({ q: searchQuery });
    }

    if (postal_code) {
      attempts.push({
        postalcode: postal_code,
        country: countryName,
      });
    }

    if (resolved.city) {
      attempts.push({
        city: resolved.city,
        country: countryName,
      });
    }

    attempts.push({ q: countryName });

    let result = null;
    for (const params of attempts) {
      result = await fetchFirstNominatimResult(params);
      if (result) break;
    }

    if (!result) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`Geocoding failed: No results found for "${searchQuery}"`);
      }
      return resolved;
    }

    const latitude = parseFloat(result.lat);
    const longitude = parseFloat(result.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return resolved;
    }

    const enriched = mergeAddressDetails(resolved, result.address);

    return {
      ...enriched,
      latitude,
      longitude,
    };
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return resolved;
  }
}

/**
 * Geocode an address using OpenStreetMap Nominatim
 * @param {Object} locationData - Location data object
 * @param {string} locationData.postal_code - Postal/ZIP code
 * @param {string} locationData.city - City name (optional)
 * @param {string} locationData.country - Country code (e.g., 'DE', 'US')
 * @returns {Promise<{latitude: number, longitude: number, state: string|null} | null>}
 */
async function geocodeAddress(locationData) {
  const resolvedLocation = await resolveLocationData(locationData);

  if (
    resolvedLocation?.latitude === null ||
    resolvedLocation?.latitude === undefined ||
    resolvedLocation?.longitude === null ||
    resolvedLocation?.longitude === undefined
  ) {
    return null;
  }

  return resolvedLocation;
}

/**
 * Check if location data has changed compared to existing data
 * @param {Object} newData - New location data
 * @param {Object} existingData - Existing location data
 * @returns {boolean}
 */
function hasLocationChanged(newData, existingData) {
  const newPostalCode = newData.postal_code || "";
  const newCity = newData.city || "";
  const newCountry = newData.country || "";
  const newState = newData.state || "";
  const newDistrict = newData.district || "";

  const existingPostalCode = existingData.postal_code || "";
  const existingCity = existingData.city || "";
  const existingCountry = existingData.country || "";
  const existingState = existingData.state || "";
  const existingDistrict = existingData.district || "";

  return (
    newPostalCode !== existingPostalCode ||
    newCity.toLowerCase() !== existingCity.toLowerCase() ||
    newCountry !== existingCountry ||
    newState.toLowerCase() !== existingState.toLowerCase() ||
    newDistrict.toLowerCase() !== existingDistrict.toLowerCase()
  );
}

module.exports = {
  geocodeAddress,
  hasLocationChanged,
  resolveLocationData,
  COUNTRY_CODES,
};
