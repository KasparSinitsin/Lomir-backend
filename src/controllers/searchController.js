const db = require("../config/database");
const {
  hasBooleanOperators,
  validateBooleanQuery,
} = require("../utils/booleanSearchParser");
const {
  computeTeamProfileMatchScores,
  computeUserProfileOverlap,
  scoreUserAgainstRole,
} = require("../utils/matchingScorer");
const { parseSearchParams } = require("../utils/search/searchParamParser");
const {
  getRolesSortDir,
  normalizeJsonArray,
  normalizeNullableNumber,
} = require("../utils/search/searchSqlBuilders");
const {
  sanitizeSearchTeam,
  sanitizeSearchUser,
} = require("../utils/search/searchResultProcessing");
const {
  fetchOpenRoleSearchResults,
  executeSearchQueries,
} = require("../utils/search/searchExecution");

const searchController = {
  /**
   * Helper function to get user's location data (coordinates, postal_code, city)
   */
  async getUserLocation(userId) {
    if (!userId) return null;

    const result = await db.pool.query(
      "SELECT latitude, longitude, postal_code, city FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) return null;

    const user = result.rows[0];

    const lat =
      user.latitude !== null && user.latitude !== undefined
        ? parseFloat(user.latitude)
        : null;

    const lng =
      user.longitude !== null && user.longitude !== undefined
        ? parseFloat(user.longitude)
        : null;

    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);

    const hasPostalCode =
      typeof user.postal_code === "string" && user.postal_code.trim() !== "";

    const hasCity = typeof user.city === "string" && user.city.trim() !== "";

    if (!hasCoordinates && !hasPostalCode && !hasCity) return null;

    return {
      latitude: hasCoordinates ? lat : null,
      longitude: hasCoordinates ? lng : null,
      postal_code: hasPostalCode ? user.postal_code.trim() : null,
      city: hasCity ? user.city.trim().toLowerCase() : null,
      hasCoordinates,
      hasPostalCode,
      hasCity,
    };
  },

  /**
   * Global search with pagination and sorting
   * Searches teams and users based on query string
   */
  async globalSearch(req, res) {
    try {
      const { query } = req.query;
      const searchParams = parseSearchParams(req);
      const {
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
      } = searchParams;

      if (process.env.NODE_ENV !== "production") {
        console.log(`Search query: "${query}"`);
        console.log(`User ID from JWT: ${userId}`);
        console.log(
          `Pagination: page=${page}, limit=${limit}, offset=${offset}`,
        );
        console.log(
          `Sort by: ${sort}, direction: ${direction}, capacityMode: ${capacityMode}, searchType: ${searchType}, openRolesOnly: ${openRolesOnly}`,
        );
        console.log(
          `Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`,
        );
        console.log(
          `Match sort: roleId=${matchRoleId || "none (profile-based)"}`,
        );
        console.log(`Exclude team members: teamId=${excludeTeamId || "none"}`);
      }

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      let userLocation = null;
      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
      }

      if (includeRoles) {
        const { roles, totalRoles } = await fetchOpenRoleSearchResults({
          query,
          sort: roleSort,
          direction,
          page,
          limit,
          userId,
          includeDemoData,
          userLocation,
          maxDistance,
        });

        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: [],
            roles,
          },
          pagination: {
            page,
            limit,
            totalTeams: 0,
            totalUsers: 0,
            totalRoles,
            totalItems: totalRoles,
            totalPages: Math.ceil(totalRoles / limit),
            hasNextPage: offset + limit < totalRoles,
            hasPrevPage: page > 1,
          },
          sorting: {
            sortBy: roleSort,
            sortDir: getRolesSortDir(roleSort, direction),
          },
        });
      }

      const useBoolean = hasBooleanOperators(query);

      if (useBoolean) {
        const validation = validateBooleanQuery(query);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            message: "Invalid boolean search query",
            error: validation.message,
          });
        }
      }

      const {
        teamCountResult,
        teamResults,
        userCountResult,
        userResults,
      } = await executeSearchQueries({
        params: searchParams,
        query,
        useBoolean,
        userLocation,
      });

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true || team.is_public === "true",
        is_remote: team.is_remote === true || team.is_remote === "true",
        tags: normalizeJsonArray(team.tags),
        available_capacity:
          team.available_capacity !== null
            ? parseInt(team.available_capacity, 10)
            : null,
        latitude: normalizeNullableNumber(team.latitude),
        longitude: normalizeNullableNumber(team.longitude),
        distance_km:
          team.distance_km !== undefined && team.distance_km !== null
            ? parseFloat(Number(team.distance_km).toFixed(1))
            : null,
        open_role_count:
          team.open_role_count !== null && team.open_role_count !== undefined
            ? parseInt(team.open_role_count, 10)
            : 0,
        open_role_names: normalizeJsonArray(team.open_role_names),
      }));

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true || user.is_public === "true",
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(Number(user.distance_km).toFixed(1))
            : null,
      }));

      // ========== MATCH SORT POST-PROCESSING ==========
      let finalTeams = teamsWithFixedVisibility;
      let finalUsers = usersWithFixedVisibility;
      let roleData = null;

      // Best Match only re-ranks the SQL result set; maxDistance stays active as an independent filter.
      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamMatches = await computeTeamProfileMatchScores(
            db,
            userId,
            teamIds,
          );
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const match = teamMatches.get(team.id);
            return {
              ...team,
              match_score: match ? match.matchScore : 0,
              best_match_score: match ? match.matchScore : 0,
              match_details: {
                tag_score: match ? match.tagScore : 0,
                badge_score: match ? match.badgeScore : 0,
                distance_score: match ? match.distanceScore : 0,
                shared_tag_count: match ? match.sharedTagCount : 0,
                total_team_tags: match ? match.totalUniqueTeamTags : 0,
                shared_badge_count: match ? match.sharedBadgeCount : 0,
                total_team_badges: match ? match.totalUniqueTeamBadges : 0,
                distance_km: match ? match.distanceKm : null,
              },
              shared_tag_count: match ? match.sharedTagCount : 0,
              shared_badge_count: match ? match.sharedBadgeCount : 0,
              match_type: "team_profile_match",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state, district
               FROM team_vacant_roles WHERE id = $1 AND status = 'open'`,
              [matchRoleId],
            );

            if (roleResult.rows.length > 0) {
              roleData = roleResult.rows[0];

              const [roleTagsRes, roleBadgesRes] = await Promise.all([
                db.pool.query(
                  `SELECT tag_id FROM team_vacant_role_tags WHERE role_id = $1`,
                  [matchRoleId],
                ),
                db.pool.query(
                  `SELECT badge_id FROM team_vacant_role_badges WHERE role_id = $1`,
                  [matchRoleId],
                ),
              ]);

              const roleTagIds = roleTagsRes.rows.map((r) => Number(r.tag_id));
              const roleBadgeIds = roleBadgesRes.rows.map((r) =>
                Number(r.badge_id),
              );

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT awarded_to_user_id AS user_id, badge_id
                   FROM badge_awards
                   WHERE awarded_to_user_id = ANY($1)`,
                  [userIds],
                ),
              ]);

              const userTagMap = {};
              const userBadgeMap = {};
              for (const r of allUserTags.rows) {
                if (!userTagMap[r.user_id]) userTagMap[r.user_id] = new Set();
                userTagMap[r.user_id].add(Number(r.tag_id));
              }
              for (const r of allUserBadges.rows) {
                if (!userBadgeMap[r.user_id])
                  userBadgeMap[r.user_id] = new Set();
                userBadgeMap[r.user_id].add(Number(r.badge_id));
              }

              finalUsers = usersWithFixedVisibility.map((user) => {
                const scores = scoreUserAgainstRole({
                  userTagIds: userTagMap[user.id] || new Set(),
                  userBadgeIds: userBadgeMap[user.id] || new Set(),
                  userLat: user.latitude,
                  userLng: user.longitude,
                  roleTagIds,
                  roleBadgeIds,
                  role: roleData,
                });

                return {
                  ...user,
                  best_match_score: scores.matchScore,
                  match_details: {
                    tag_score: scores.tagScore,
                    badge_score: scores.badgeScore,
                    distance_score: scores.distanceScore,
                    distance_km: scores.distanceKm,
                  },
                  match_type: "role_match",
                };
              });

              finalUsers.sort(
                (a, b) => b.best_match_score - a.best_match_score,
              );
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(
              db,
              userId,
              userIds,
            );
            finalUsers = usersWithFixedVisibility.map((user) => {
              const overlap = userOverlap.get(user.id);
              return {
                ...user,
                best_match_score: overlap ? overlap.overlapScore : 0,
                shared_tag_count: overlap ? overlap.sharedTagCount : 0,
                shared_badge_count: overlap ? overlap.sharedBadgeCount : 0,
                match_type: "profile_overlap",
              };
            });

            finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
          }
        } catch (matchErr) {
          console.error("Error computing match scores for search:", matchErr);
        }
      }

      const paginatedTeams = isMatchSort
        ? finalTeams.slice(offset, offset + limit)
        : finalTeams;

      const paginatedUsers = isMatchSort
        ? finalUsers.slice(offset, offset + limit)
        : finalUsers;

      let rolesForAll = [];
      let totalRolesForAll = 0;

      if (searchType === "all") {
        ({ roles: rolesForAll, totalRoles: totalRolesForAll } =
          await fetchOpenRoleSearchResults({
            query,
            sort: roleSort,
            direction,
            page,
            limit,
            userId,
            includeDemoData,
            userLocation,
            maxDistance,
          }));
      }

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers, totalRolesForAll);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers + totalRolesForAll;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams.map(sanitizeSearchTeam),
          users: paginatedUsers.map(sanitizeSearchUser),
          roles: rolesForAll,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalRoles: totalRolesForAll,
          totalItems,
          totalPages: Math.ceil(paginationBaseItems / limit),
          hasNextPage: offset + limit < paginationBaseItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        matchRole: roleData
          ? {
              id: roleData.id,
              roleName: roleData.role_name,
              isRemote: roleData.is_remote,
              city: roleData.city,
              country: roleData.country,
            }
          : null,
        userLocation: userLocation
          ? { hasLocation: true, hasCoordinates: !!userLocation.hasCoordinates }
          : { hasLocation: false, hasCoordinates: false },
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({
        success: false,
        message: "Error performing search",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Get all users and teams with pagination and sorting
   * Used when page loads initially (no search query)
   */
  async getAllUsersAndTeams(req, res) {
    try {
      const searchParams = parseSearchParams(req);
      const {
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
      } = searchParams;

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `getAllUsersAndTeams: userId=${userId}, page=${page}, limit=${limit}, sortBy=${sort}, sortDir=${direction}, capacityMode=${capacityMode}, searchType=${searchType}, openRolesOnly=${openRolesOnly}`,
        );
        console.log(
          `Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`,
        );
        console.log(
          `Match sort: roleId=${matchRoleId || "none (profile-based)"}`,
        );
        console.log(`Exclude team members: teamId=${excludeTeamId || "none"}`);
      }

      let userLocation = null;
      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
      }

      if (includeRoles) {
        const { roles, totalRoles } = await fetchOpenRoleSearchResults({
          sort: roleSort,
          direction,
          page,
          limit,
          userId,
          includeDemoData,
          userLocation,
          maxDistance,
        });

        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: [],
            roles,
          },
          pagination: {
            page,
            limit,
            totalTeams: 0,
            totalUsers: 0,
            totalRoles,
            totalItems: totalRoles,
            totalPages: Math.ceil(totalRoles / limit),
            hasNextPage: offset + limit < totalRoles,
            hasPrevPage: page > 1,
          },
          sorting: {
            sortBy: roleSort,
            sortDir: getRolesSortDir(roleSort, direction),
          },
        });
      }

      const {
        teamCountResult,
        teamResults,
        userCountResult,
        userResults,
      } = await executeSearchQueries({
        params: searchParams,
        userLocation,
      });

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true || team.is_public === "true",
        is_remote: team.is_remote === true || team.is_remote === "true",
        tags: normalizeJsonArray(team.tags),
        available_capacity:
          team.available_capacity !== null
            ? parseInt(team.available_capacity, 10)
            : null,
        latitude: normalizeNullableNumber(team.latitude),
        longitude: normalizeNullableNumber(team.longitude),
        distance_km:
          team.distance_km !== undefined && team.distance_km !== null
            ? parseFloat(Number(team.distance_km).toFixed(1))
            : null,
        open_role_count:
          team.open_role_count !== null && team.open_role_count !== undefined
            ? parseInt(team.open_role_count, 10)
            : 0,
        open_role_names: normalizeJsonArray(team.open_role_names),
      }));

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true || user.is_public === "true",
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(Number(user.distance_km).toFixed(1))
            : null,
      }));

      // ========== MATCH SORT POST-PROCESSING ==========
      let finalTeams = teamsWithFixedVisibility;
      let finalUsers = usersWithFixedVisibility;
      let roleData = null;

      // Best Match only re-ranks the SQL result set; maxDistance stays active as an independent filter.
      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamMatches = await computeTeamProfileMatchScores(
            db,
            userId,
            teamIds,
          );
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const match = teamMatches.get(team.id);
            return {
              ...team,
              match_score: match ? match.matchScore : 0,
              best_match_score: match ? match.matchScore : 0,
              match_details: {
                tag_score: match ? match.tagScore : 0,
                badge_score: match ? match.badgeScore : 0,
                distance_score: match ? match.distanceScore : 0,
                shared_tag_count: match ? match.sharedTagCount : 0,
                total_team_tags: match ? match.totalUniqueTeamTags : 0,
                shared_badge_count: match ? match.sharedBadgeCount : 0,
                total_team_badges: match ? match.totalUniqueTeamBadges : 0,
                distance_km: match ? match.distanceKm : null,
              },
              shared_tag_count: match ? match.sharedTagCount : 0,
              shared_badge_count: match ? match.sharedBadgeCount : 0,
              match_type: "team_profile_match",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state, district
               FROM team_vacant_roles WHERE id = $1 AND status = 'open'`,
              [matchRoleId],
            );

            if (roleResult.rows.length > 0) {
              roleData = roleResult.rows[0];

              const [roleTagsRes, roleBadgesRes] = await Promise.all([
                db.pool.query(
                  `SELECT tag_id FROM team_vacant_role_tags WHERE role_id = $1`,
                  [matchRoleId],
                ),
                db.pool.query(
                  `SELECT badge_id FROM team_vacant_role_badges WHERE role_id = $1`,
                  [matchRoleId],
                ),
              ]);

              const roleTagIds = roleTagsRes.rows.map((r) => Number(r.tag_id));
              const roleBadgeIds = roleBadgesRes.rows.map((r) =>
                Number(r.badge_id),
              );

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT awarded_to_user_id AS user_id, badge_id
                   FROM badge_awards
                   WHERE awarded_to_user_id = ANY($1)`,
                  [userIds],
                ),
              ]);

              const userTagMap = {};
              const userBadgeMap = {};
              for (const r of allUserTags.rows) {
                if (!userTagMap[r.user_id]) userTagMap[r.user_id] = new Set();
                userTagMap[r.user_id].add(Number(r.tag_id));
              }
              for (const r of allUserBadges.rows) {
                if (!userBadgeMap[r.user_id])
                  userBadgeMap[r.user_id] = new Set();
                userBadgeMap[r.user_id].add(Number(r.badge_id));
              }

              finalUsers = usersWithFixedVisibility.map((user) => {
                const scores = scoreUserAgainstRole({
                  userTagIds: userTagMap[user.id] || new Set(),
                  userBadgeIds: userBadgeMap[user.id] || new Set(),
                  userLat: user.latitude,
                  userLng: user.longitude,
                  roleTagIds,
                  roleBadgeIds,
                  role: roleData,
                });

                return {
                  ...user,
                  best_match_score: scores.matchScore,
                  match_details: {
                    tag_score: scores.tagScore,
                    badge_score: scores.badgeScore,
                    distance_score: scores.distanceScore,
                    distance_km: scores.distanceKm,
                  },
                  match_type: "role_match",
                };
              });

              finalUsers.sort(
                (a, b) => b.best_match_score - a.best_match_score,
              );
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(
              db,
              userId,
              userIds,
            );
            finalUsers = usersWithFixedVisibility.map((user) => {
              const overlap = userOverlap.get(user.id);
              return {
                ...user,
                best_match_score: overlap ? overlap.overlapScore : 0,
                shared_tag_count: overlap ? overlap.sharedTagCount : 0,
                shared_badge_count: overlap ? overlap.sharedBadgeCount : 0,
                match_type: "profile_overlap",
              };
            });

            finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
          }
        } catch (matchErr) {
          console.error("Error computing match scores for search:", matchErr);
        }
      }

      const paginatedTeams = isMatchSort
        ? finalTeams.slice(offset, offset + limit)
        : finalTeams;

      const paginatedUsers = isMatchSort
        ? finalUsers.slice(offset, offset + limit)
        : finalUsers;

      let rolesForAll = [];
      let totalRolesForAll = 0;

      if (searchType === "all") {
        ({ roles: rolesForAll, totalRoles: totalRolesForAll } =
          await fetchOpenRoleSearchResults({
            sort: roleSort,
            direction,
            page,
            limit,
            userId,
            includeDemoData,
            userLocation,
            maxDistance,
          }));
      }

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers, totalRolesForAll);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers + totalRolesForAll;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams.map(sanitizeSearchTeam),
          users: paginatedUsers.map(sanitizeSearchUser),
          roles: rolesForAll,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalRoles: totalRolesForAll,
          totalItems,
          totalPages: Math.ceil(paginationBaseItems / limit),
          hasNextPage: offset + limit < paginationBaseItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        matchRole: roleData
          ? {
              id: roleData.id,
              roleName: roleData.role_name,
              isRemote: roleData.is_remote,
              city: roleData.city,
              country: roleData.country,
            }
          : null,
        userLocation: userLocation
          ? { hasLocation: true, hasCoordinates: !!userLocation.hasCoordinates }
          : { hasLocation: false, hasCoordinates: false },
      });
    } catch (error) {
      console.error("Error fetching all users and teams:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching data",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },
};

module.exports = searchController;
