const db = require("../config/database");

const teamModel = {
  /**
   * Create a new team in the database
   * @param {Object} teamData - Team data (name, description, tags, etc.)
   * @returns {Object} Created team object
   */
  async createTeam(teamData) {
    const { tags, ...teamDetails } = teamData;

    const client = await db.pool.connect();

    try {
      // Start a database transaction
      await client.query("BEGIN");

      // Insert team
      const teamResult = await client.query(
        `
  INSERT INTO teams (
    name,
    description,
    is_public,
    max_members,
    teamavatar_url,
    is_remote,
    postal_code,
    city,
    state,
    district,
    country,
    is_synthetic
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  RETURNING
    id, name, description, is_public, max_members,
    teamavatar_url, is_remote, postal_code, city, state, district, country, is_synthetic
`,
        [
          teamDetails.name,
          teamDetails.description,
          teamDetails.is_public,
          teamDetails.max_members,
          teamDetails.teamavatar_url ?? null,
          teamDetails.is_remote ?? false,
          teamDetails.is_remote ? null : (teamDetails.postal_code ?? null),
          teamDetails.is_remote ? null : (teamDetails.city ?? null),
          teamDetails.is_remote ? null : (teamDetails.state ?? null),
          teamDetails.is_remote ? null : (teamDetails.district ?? null),
          teamDetails.is_remote ? null : (teamDetails.country ?? null),
          teamDetails.is_synthetic,
        ],
      );

      const teamId = teamResult.rows[0].id;

      // Insert team tags if present
      if (tags && tags.length > 0) {
        const tagInserts = tags.map((tag) =>
          client.query(
            `
            INSERT INTO team_tags (
              team_id, 
              tag_id
            ) VALUES ($1, $2)
          `,
            [teamId, tag.tag_id],
          ),
        );

        await Promise.all(tagInserts);
      }

      // Commit the transaction
      await client.query("COMMIT");

      // Return the team details
      return teamResult.rows[0];
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query("ROLLBACK");
      console.error("Error creating team:", error);
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  },

  /**
   * Update an existing team in the database (including location fields)
   * Supports updating tags via team_tags join table.
   *
   * Location rules:
   * - if is_remote === true  -> postal_code/city/country are forced to NULL
   * - if is_remote === false -> location fields stored as provided (or NULL)
   */
  async updateTeam(teamId, teamData) {
    const { tags, ...teamDetails } = teamData;

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // --- Normalize location fields (IMPORTANT) ---
      // Accept both snake_case and camelCase to be safe
      const isRemoteRaw =
        teamDetails.is_remote ?? teamDetails.isRemote ?? false;

      const isRemote =
        isRemoteRaw === true || isRemoteRaw === "true" || isRemoteRaw === 1;

      const postalCode =
        teamDetails.postal_code ?? teamDetails.postalCode ?? null;
      const city = teamDetails.city ?? null;
      const state = teamDetails.state ?? null;
      const district = teamDetails.district ?? null;
      const country = teamDetails.country ?? null;

      // If remote: force location fields to NULL
      const finalPostalCode = isRemote ? null : postalCode || null;
      const finalCity = isRemote ? null : city || null;
      const finalState = isRemote ? null : state || null;
      const finalDistrict = isRemote ? null : district || null;
      const finalCountry = isRemote ? null : country || null;

      // --- Update teams table ---
      // NOTE: You can add/remove fields here depending on what you allow updating.
      const updateResult = await client.query(
        `
      UPDATE teams
      SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        is_public = COALESCE($4, is_public),
        max_members = $5,
        teamavatar_url = COALESCE($6, teamavatar_url),
        is_remote = $7,
        postal_code = $8,
        city = $9,
        state = $10,
        district = $11,
        country = $12
      WHERE id = $1
      RETURNING
        id, name, description, is_public, max_members,
        teamavatar_url, is_remote, postal_code, city, state, district, country
      `,
        [
          teamId,
          teamDetails.name ?? null,
          teamDetails.description ?? null,
          typeof teamDetails.is_public === "boolean"
            ? teamDetails.is_public
            : null,
          // max_members: allow NULL for unlimited; if omitted entirely keep existing
          teamDetails.max_members !== undefined
            ? teamDetails.max_members
            : null,
          teamDetails.teamavatar_url ?? null,
          isRemote,
          finalPostalCode,
          finalCity,
          finalState,
          finalDistrict,
          finalCountry,
        ],
      );

      // If you want "max_members omitted" to preserve old value, do this instead:
      // - read current max_members first OR build dynamic SQL.
      // For now, this expects your controller sends max_members always (which your UI does).

      if (!updateResult.rows[0]) {
        throw new Error("Team not found");
      }

      // --- Update team tags (optional) ---
      // If tags is provided, we replace existing tags with the new set.
      if (Array.isArray(tags)) {
        // Clear existing
        await client.query(`DELETE FROM team_tags WHERE team_id = $1`, [
          teamId,
        ]);

        // Insert new
        if (tags.length > 0) {
          const tagInserts = tags.map((tag) =>
            client.query(
              `
            INSERT INTO team_tags (team_id, tag_id)
            VALUES ($1, $2)
            `,
              [teamId, tag.tag_id],
            ),
          );

          await Promise.all(tagInserts);
        }
      }

      await client.query("COMMIT");
      return updateResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error updating team:", error);
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Find a team by ID
   * @param {Number} id - Team ID
   * @returns {Object|null} Team object or null if not found
   */
  async findById(id) {
    const result = await db.query(
      `SELECT
     id, name, description, is_public, max_members,
     teamavatar_url, is_remote, postal_code, city, state, district, country
   FROM teams
   WHERE id = $1`,
      [id],
    );

    return result.rows[0] || null;
  },

};

module.exports = teamModel;
