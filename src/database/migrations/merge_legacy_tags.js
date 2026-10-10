const db = require("../../config/database");

/**
 * Merges the four `(legacy)` focus areas into their current versions and deletes them
 * (STATUS item 11, the tag taxonomy).
 *
 * 🔴 **Why it exists.** Four tags were archived as "<name> (legacy)" when their current
 * version was added: Music Production, Public Speaking, Hiking, Camping. Nothing reads
 * `tags.status`, so every tag endpoint still returned them ("Hiking (legacy)" showed in
 * the search suggestions), and each would have needed a German translation of its own.
 * Julia decided on 2026-10-10: consolidate and DELETE them.
 *
 * ✅ **Measured on production, 2026-10-10** (`deletion-audit/71`, `72`): the mapping is
 * right for all four (archived, same category and supercategory, name = current + " (legacy)");
 * exactly TWO rows point at a legacy tag, both in `team_tags` (45 and 319), and both teams
 * already have the current version, so they are DELETED, not repointed. `user_tags`,
 * `team_vacant_role_tags`, `badge_awards`: 0 rows. No tag has a legacy tag as `parent_id`.
 *
 * 🟢 **What it does.**
 *   1  `team_tags`: a team that has the legacy AND the current tag loses the legacy row;
 *      a team that has only the legacy tag gets it repointed (measured: none today).
 *   2  Deletes the legacy tag rows, but only those that match the mapping exactly and that
 *      nothing points at any more (any table, and `tags.parent_id`).
 *
 * 🔴 **What it refuses.** A legacy tag that a `user_tags`, `team_vacant_role_tags` or
 * `badge_awards` row still points at is NOT touched, and the whole run rolls back with an
 * error: those rows carry credits, levels or history and would need their own rule. The
 * dry run said there are none; a count above that is a premise that broke.
 *
 * 🟢 **Idempotent by guard.** Once the rows are gone there is nothing to match.
 * 🔴 **Verified by itself.** `index.js` swallows a module's error, so this owns its
 * transaction, re-counts after writing, and rolls back unless nothing is left.
 *
 * Dry run: `deletion-audit/71` (references) and `72` (team_tags). The 89 orphaned
 * `user_tags` rows found on the way (`73`) are NOT touched here.
 */

// legacy tag id -> current tag id. Names are re-checked in SQL, never trusted.
const MAPPING = [
  [45, 265], // Music Production
  [202, 60], // Public Speaking
  [319, 38], // Hiking
  [320, 39], // Camping
];
const EXPECTED_TEAM_TAGS_DELETED = 2; // `deletion-audit/72` on production, 2026-10-10
const MAX_ROWS = 20; // far above the measured 2; a larger count means the rule is too wide

// Only a pair that is still what the dry run saw: the legacy row archived, the current
// one approved, the same category, the legacy name = the current name + " (legacy)".
const PAIRS_SQL = `
  SELECT m.legacy_id, m.current_id
  FROM unnest($1::int[], $2::int[]) AS m(legacy_id, current_id)
  JOIN tags l ON l.id = m.legacy_id
  JOIN tags c ON c.id = m.current_id
  WHERE l.status = 'archived' AND c.status = 'approved'
    AND l.name = c.name || ' (legacy)'
    AND l.category = c.category AND l.supercategory = c.supercategory
`;

// Rows in tables that must not be handled silently.
const BLOCKERS_SQL = `
  SELECT 'user_tags' AS t, count(*)::int AS n FROM user_tags WHERE tag_id = ANY($1::int[])
  UNION ALL SELECT 'team_vacant_role_tags', count(*)::int FROM team_vacant_role_tags WHERE tag_id = ANY($1::int[])
  UNION ALL SELECT 'badge_awards', count(*)::int FROM badge_awards WHERE tag_id = ANY($1::int[])
  UNION ALL SELECT 'tags.parent_id', count(*)::int FROM tags WHERE parent_id = ANY($1::int[])
`;

const DELETE_DUPLICATE_LINKS_SQL = `
  DELETE FROM team_tags a
  USING (${PAIRS_SQL}) p
  WHERE a.tag_id = p.legacy_id
    AND EXISTS (SELECT 1 FROM team_tags b WHERE b.team_id = a.team_id AND b.tag_id = p.current_id)
`;

const REPOINT_LINKS_SQL = `
  UPDATE team_tags a SET tag_id = p.current_id
  FROM (${PAIRS_SQL}) p
  WHERE a.tag_id = p.legacy_id
`;

const DELETE_TAGS_SQL = `
  DELETE FROM tags l
  USING (${PAIRS_SQL}) p
  WHERE l.id = p.legacy_id
    AND NOT EXISTS (SELECT 1 FROM team_tags x WHERE x.tag_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM user_tags x WHERE x.tag_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM team_vacant_role_tags x WHERE x.tag_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM badge_awards x WHERE x.tag_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM tags x WHERE x.parent_id = l.id)
`;

// Legacy ids still in `tags` AFTER writing. Counts the ids, not the pairs that still match:
// a pair whose names or categories changed is skipped above, and must fail here, not pass.
const REMAINING_SQL = `SELECT count(*)::int AS remaining FROM tags WHERE id = ANY($1::int[])`;

const mergeLegacyTags = async () => {
  const legacyIds = MAPPING.map(([legacy]) => legacy);
  const currentIds = MAPPING.map(([, current]) => current);
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: blockers } = await client.query(BLOCKERS_SQL, [legacyIds]);
    const blocked = blockers.filter((b) => b.n > 0);
    if (blocked.length > 0) {
      throw new Error(
        "legacy tag merge refused — rows the dry run did not find still point at a legacy " +
          `tag: ${blocked.map((b) => `${b.t} ${b.n}`).join(", ")}. Rolled back. ` +
          "Re-run deletion-audit/71 and decide how those rows are handled.",
      );
    }

    const deleted = await client.query(DELETE_DUPLICATE_LINKS_SQL, [legacyIds, currentIds]);
    const repointed = await client.query(REPOINT_LINKS_SQL, [legacyIds, currentIds]);
    const touched = deleted.rowCount + repointed.rowCount;

    if (touched > MAX_ROWS) {
      throw new Error(
        `legacy tag merge would change ${touched} team_tags rows, but only ` +
          `${EXPECTED_TEAM_TAGS_DELETED} were measured — rolled back. The rule is too wide.`,
      );
    }

    const removed = await client.query(DELETE_TAGS_SQL, [legacyIds, currentIds]);
    const { rows } = await client.query(REMAINING_SQL, [legacyIds]);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `legacy tag merge left ${rows[0].remaining} legacy tags behind — rolled back. ` +
          "Something still points at them, or the rule and the data disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `legacy tag merge: ${deleted.rowCount} duplicate team_tags rows deleted ` +
        `(dry run ${EXPECTED_TEAM_TAGS_DELETED}), ${repointed.rowCount} repointed, ` +
        `${removed.rowCount} legacy tags deleted (0 left).`,
    );
    if (
      deleted.rowCount !== 0 &&
      (deleted.rowCount !== EXPECTED_TEAM_TAGS_DELETED || repointed.rowCount !== 0)
    ) {
      console.log(
        "legacy tag merge: ⚠️ the counts differ from the dry run — re-run " +
          "deletion-audit/72 and read why before trusting it.",
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error merging the legacy tags (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = mergeLegacyTags;
module.exports.MAPPING = MAPPING;
module.exports.EXPECTED_TEAM_TAGS_DELETED = EXPECTED_TEAM_TAGS_DELETED;
module.exports.MAX_ROWS = MAX_ROWS;
