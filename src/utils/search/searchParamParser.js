// Query-string parsing for the search endpoints: normalizes raw request
// params into a typed, validated search configuration object.

const VALID_SEARCH_TYPES = ["all", "teams", "users", "roles"];
const VALID_ROLE_SORTS = ["recent", "newest", "name", "match", "proximity"];

function parseSearchType(value) {
  if (typeof value !== "string") return "all";

  const normalized = value.toLowerCase();
  return VALID_SEARCH_TYPES.includes(normalized) ? normalized : "all";
}

function parseBooleanFlag(value) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function parseIncludeDemoData(value) {
  return !(typeof value === "string" && value.toLowerCase() === "false");
}

function parseRoleSort(value) {
  if (typeof value !== "string") return "newest";

  const normalized = value.toLowerCase();
  return VALID_ROLE_SORTS.includes(normalized) ? normalized : "newest";
}

function parseSearchParams(req) {
  const { sortBy, sortDir } = req.query;
  const userId = req.user?.id;
  const searchType = parseSearchType(req.query.searchType);
  const includeTeams = searchType === "all" || searchType === "teams";
  const includeUsers = searchType === "all" || searchType === "users";
  const includeRoles = searchType === "roles";
  const openRolesOnly = parseBooleanFlag(req.query.openRolesOnly);
  const includeDemoData = parseIncludeDemoData(req.query.includeDemoData);
  const excludeOwnTeams =
    parseBooleanFlag(req.query.excludeOwnTeams) && !!userId;
  const excludeTeamId = req.query.excludeTeamId
    ? parseInt(req.query.excludeTeamId, 10)
    : null;
  const hasValidExcludeTeamId =
    excludeTeamId !== null &&
    Number.isFinite(excludeTeamId) &&
    excludeTeamId > 0;

  const tagIds = req.query.tagIds
    ? req.query.tagIds.split(",").map(Number).filter(Number.isFinite)
    : [];
  const badgeIds = req.query.badgeIds
    ? req.query.badgeIds.split(",").map(Number).filter(Number.isFinite)
    : [];

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  const validSortOptions = [
    "recent",
    "newest",
    "name",
    "capacity",
    "proximity",
    "match",
  ];
  const sort = validSortOptions.includes(sortBy) ? sortBy : "name";
  const roleSort = parseRoleSort(sortBy);

  const validDirections = ["asc", "desc", "remote"];
  const direction = validDirections.includes(sortDir)
    ? sortDir.toUpperCase()
    : "ASC";

  const isMatchSort = sort === "match" && !!userId;
  const matchRoleId = req.query.roleId
    ? parseInt(req.query.roleId, 10)
    : null;

  const maxDistance = req.query.maxDistance
    ? parseFloat(req.query.maxDistance)
    : null;
  const hasValidMaxDistance =
    maxDistance !== null && Number.isFinite(maxDistance) && maxDistance > 0;

  const capacityMode = req.query.capacityMode === "roles" ? "roles" : "spots";

  return {
    badgeIds,
    capacityMode,
    direction,
    excludeOwnTeams,
    excludeTeamId,
    hasValidExcludeTeamId,
    hasValidMaxDistance,
    includeDemoData,
    includeRoles,
    includeTeams,
    includeUsers,
    isMatchSort,
    limit,
    matchRoleId,
    maxDistance,
    offset,
    openRolesOnly,
    page,
    roleSort,
    searchType,
    sort,
    tagIds,
    userId,
  };
}

module.exports = {
  parseSearchParams,
};
