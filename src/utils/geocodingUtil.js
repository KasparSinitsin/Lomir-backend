/**
 * Geocoding Utility
 * Converts postal code + country to latitude/longitude coordinates
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 */

const axios = require("axios");

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
  // Add more as needed
};

/**
 * Geocode an address using OpenStreetMap Nominatim
 * @param {Object} locationData - Location data object
 * @param {string} locationData.postal_code - Postal/ZIP code
 * @param {string} locationData.city - City name (optional)
 * @param {string} locationData.country - Country code (e.g., 'DE', 'US')
 * @returns {Promise<{latitude: number, longitude: number} | null>}
 */
async function geocodeAddress({ postal_code, city, country }) {
  // Need at least postal_code and country, or city and country
  if (!country) {
    console.log("Geocoding skipped: No country provided");
    return null;
  }

  if (!postal_code && !city) {
    console.log("Geocoding skipped: No postal_code or city provided");
    return null;
  }

  try {
    // Build the search query
    const countryName = COUNTRY_CODES[country] || country;

    // Build query parts
    const queryParts = [];
    if (postal_code) queryParts.push(postal_code);
    if (city) queryParts.push(city);
    queryParts.push(countryName);

    const searchQuery = queryParts.join(", ");

    console.log(`Geocoding address: "${searchQuery}"`);

    // Call Nominatim API
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: searchQuery,
          format: "json",
          limit: 1,
          addressdetails: 1,
        },
        headers: {
          "User-Agent": "Lomir-App/1.0 (team-building-app)",
        },
        timeout: 10000, // 10 second timeout
      },
    );

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      const latitude = parseFloat(result.lat);
      const longitude = parseFloat(result.lon);

      console.log(
        `Geocoding success: "${searchQuery}" -> lat: ${latitude}, lng: ${longitude}`,
      );

      return {
        latitude,
        longitude,
      };
    }

    // If first attempt failed and we have both postal_code and city, try with just postal_code + country
    if (postal_code && city) {
      console.log(
        `Geocoding retry with postal_code + country only: "${postal_code}, ${countryName}"`,
      );

      const retryResponse = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
          params: {
            postalcode: postal_code,
            country: countryName,
            format: "json",
            limit: 1,
            addressdetails: 1,
          },
          headers: {
            "User-Agent": "Lomir-App/1.0 (team-building-app)",
          },
          timeout: 10000,
        },
      );

      if (retryResponse.data && retryResponse.data.length > 0) {
        const result = retryResponse.data[0];
        const latitude = parseFloat(result.lat);
        const longitude = parseFloat(result.lon);

        console.log(
          `Geocoding retry success: lat: ${latitude}, lng: ${longitude}`,
        );

        return {
          latitude,
          longitude,
        };
      }
    }

    // If still no result and we have city, try city + country
    if (city) {
      console.log(
        `Geocoding retry with city + country only: "${city}, ${countryName}"`,
      );

      const cityResponse = await axios.get(
        "https://nominatim.openstreetmap.org/search",
        {
          params: {
            city: city,
            country: countryName,
            format: "json",
            limit: 1,
            addressdetails: 1,
          },
          headers: {
            "User-Agent": "Lomir-App/1.0 (team-building-app)",
          },
          timeout: 10000,
        },
      );

      if (cityResponse.data && cityResponse.data.length > 0) {
        const result = cityResponse.data[0];
        const latitude = parseFloat(result.lat);
        const longitude = parseFloat(result.lon);

        console.log(
          `Geocoding city retry success: lat: ${latitude}, lng: ${longitude}`,
        );

        return {
          latitude,
          longitude,
        };
      }
    }

    console.log(`Geocoding failed: No results found for "${searchQuery}"`);
    return null;
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return null;
  }
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

  const existingPostalCode = existingData.postal_code || "";
  const existingCity = existingData.city || "";
  const existingCountry = existingData.country || "";

  return (
    newPostalCode !== existingPostalCode ||
    newCity.toLowerCase() !== existingCity.toLowerCase() ||
    newCountry !== existingCountry
  );
}

module.exports = {
  geocodeAddress,
  hasLocationChanged,
  COUNTRY_CODES,
};
