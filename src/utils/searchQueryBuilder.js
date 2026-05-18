function sanitizeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function buildHaversineDistanceSQL(tableAlias, userLocation) {
  return `CASE
              WHEN ${tableAlias}.latitude IS NULL OR ${tableAlias}.longitude IS NULL THEN 999999
              ELSE (
                6371 * acos(
                  LEAST(1.0, GREATEST(-1.0,
                    cos(radians(${userLocation.latitude})) * cos(radians(${tableAlias}.latitude)) *
                    cos(radians(${tableAlias}.longitude) - radians(${userLocation.longitude})) +
                    sin(radians(${userLocation.latitude})) * sin(radians(${tableAlias}.latitude))
                  ))
                )
              )
            END`;
}

function buildPostalCodeDistanceSQL(
  userPostalCode,
  tableAlias,
  postalCodeColumn = "postal_code",
) {
  const sanitizedPostalCode = sanitizeSqlLiteral(userPostalCode);

  return `
      CASE
        WHEN ${tableAlias}.${postalCodeColumn} IS NULL OR ${tableAlias}.${postalCodeColumn} = '' THEN 999999
        WHEN ${tableAlias}.${postalCodeColumn} = '${sanitizedPostalCode}' THEN 0
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 4) = LEFT('${sanitizedPostalCode}', 4) THEN 1
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 3) = LEFT('${sanitizedPostalCode}', 3) THEN 2
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 2) = LEFT('${sanitizedPostalCode}', 2) THEN 3
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 1) = LEFT('${sanitizedPostalCode}', 1) THEN 4
        ELSE 5
      END
    `;
}

function buildCityDistanceSQL(userCity, tableAlias) {
  const sanitizedCity = sanitizeSqlLiteral(userCity);

  return `
      CASE
        WHEN ${tableAlias}.city IS NULL OR ${tableAlias}.city = '' THEN 999999
        WHEN LOWER(${tableAlias}.city) = '${sanitizedCity}' THEN 0
        ELSE 999998
      END
    `;
}

function buildDistanceSQL(tableAlias, userLocation, options = {}) {
  if (!userLocation) return null;

  if (userLocation.hasCoordinates) {
    return buildHaversineDistanceSQL(tableAlias, userLocation);
  }

  if (userLocation.hasPostalCode) {
    return buildPostalCodeDistanceSQL(userLocation.postal_code, tableAlias);
  }

  if (userLocation.hasCity) {
    if (options.cityFallback === "constant") {
      return "999999";
    }

    return buildCityDistanceSQL(userLocation.city, tableAlias);
  }

  return null;
}

function buildDistanceSelectSQL(tableAlias, userLocation, options = {}) {
  const distanceSQL = buildDistanceSQL(tableAlias, userLocation, options);
  return distanceSQL ? `,\n            ${distanceSQL} as distance_km` : "";
}

function buildDistanceFilterSQL(userLocation, tableAlias, paramPlaceholder) {
  if (!userLocation || !userLocation.hasCoordinates) return null;

  return `
      AND ${tableAlias}.latitude IS NOT NULL
      AND ${tableAlias}.longitude IS NOT NULL
      AND (
        6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${userLocation.latitude})) * cos(radians(${tableAlias}.latitude)) *
            cos(radians(${tableAlias}.longitude) - radians(${userLocation.longitude})) +
            sin(radians(${userLocation.latitude})) * sin(radians(${tableAlias}.latitude))
          ))
        )
      ) <= ${paramPlaceholder}
    `;
}

function buildNearestPrioritySQL(tableAlias, userLocation) {
  if (userLocation?.hasCoordinates) {
    return `(CASE WHEN ${tableAlias}.is_remote IS TRUE THEN 2 WHEN ${tableAlias}.latitude IS NULL OR ${tableAlias}.longitude IS NULL THEN 1 ELSE 0 END)`;
  }

  if (userLocation?.hasPostalCode) {
    return `(CASE WHEN ${tableAlias}.is_remote IS TRUE THEN 2 WHEN ${tableAlias}.postal_code IS NULL OR ${tableAlias}.postal_code = '' THEN 1 ELSE 0 END)`;
  }

  if (userLocation?.hasCity) {
    return `(CASE WHEN ${tableAlias}.is_remote IS TRUE THEN 2 WHEN ${tableAlias}.city IS NULL OR ${tableAlias}.city = '' THEN 1 ELSE 0 END)`;
  }

  return `(CASE WHEN ${tableAlias}.is_remote IS TRUE THEN 1 ELSE 0 END)`;
}

module.exports = {
  buildCityDistanceSQL,
  buildDistanceFilterSQL,
  buildDistanceSelectSQL,
  buildDistanceSQL,
  buildNearestPrioritySQL,
  buildPostalCodeDistanceSQL,
};
