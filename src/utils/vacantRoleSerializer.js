const FILLED_BY_USER_COLUMN_NAMES = [
  "filled_by_user_id",
  "filled_by_user_first_name",
  "filled_by_user_last_name",
  "filled_by_user_username",
  "filled_by_user_avatar_url",
  "filled_by_user_is_public",
];

const buildFilledByUserFromRow = (row, prefix = "") => {
  const id = row[`${prefix}filled_by_user_id`];

  if (id === null || id === undefined) {
    return null;
  }

  return {
    id,
    first_name: row[`${prefix}filled_by_user_first_name`] ?? null,
    last_name: row[`${prefix}filled_by_user_last_name`] ?? null,
    username: row[`${prefix}filled_by_user_username`] ?? null,
    avatar_url: row[`${prefix}filled_by_user_avatar_url`] ?? null,
    is_public: row[`${prefix}filled_by_user_is_public`] ?? null,
  };
};

const stripFilledByUserColumns = (row, prefix = "") => {
  const serialized = { ...row };

  for (const columnName of FILLED_BY_USER_COLUMN_NAMES) {
    delete serialized[`${prefix}${columnName}`];
  }

  return serialized;
};

const serializeVacantRole = (row, extraFields = {}) => ({
  ...stripFilledByUserColumns(row),
  filled_by_user: buildFilledByUserFromRow(row),
  ...extraFields,
});

const serializeEmbeddedVacantRole = (row, extraFields = {}) => ({
  id: row.role_id,
  role_name: row.role_name,
  bio: row.role_bio,
  city: row.role_city,
  country: row.role_country,
  state: row.role_state,
  district: row.role_district,
  is_remote: row.role_is_remote,
  latitude: row.role_latitude,
  longitude: row.role_longitude,
  max_distance_km: row.role_max_distance_km,
  status: row.role_status,
  is_synthetic: row.role_is_synthetic === true,
  filled_by: row.role_filled_by,
  filled_by_user: buildFilledByUserFromRow(row, "role_"),
  ...extraFields,
});

module.exports = {
  buildFilledByUserFromRow,
  serializeVacantRole,
  serializeEmbeddedVacantRole,
};
