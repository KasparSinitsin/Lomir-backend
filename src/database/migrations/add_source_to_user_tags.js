const db = require("../../config/database");

/**
 * Where a focus area came from: the user chose it, or a badge giver's award
 * created it.
 *
 * ⚠️ **The distinction exists nowhere else, and it is destroyed every time a
 * profile is saved.** `badgeController` inserts a `user_tags` row when a badge
 * is linked to a tag the user does not have; `userTagsBadgesController` then
 * deletes every row for that user and re-inserts the submitted list, stamping
 * the default levels onto it. Measured 2026-09-28 on user 374: all three of
 * their focus areas carried `interest 3 / experience 2`, including the one that
 * had come from a badge. Without this column no display rule can tell them
 * apart, and two of them must behave differently:
 *
 * - `'user'` — always shown, credits only once an award is visible
 * - `'award'` — shown only once a linked award is visible
 *
 * 🔴 **Every existing row becomes `'user'`, and that is deliberate.** A
 * heuristic was tried and is disproved: "both levels NULL plus a linked award"
 * looked like it identified award-created rows, but user 187's `JavaScript`,
 * `Language Exchange`, `Nature Photography` and `Sports & Fitness` all carry
 * NULL levels and were all chosen by her — NULL is seed data there, not a trace
 * of the award path. Marking them `'award'` would hide focus areas their owner
 * picked, which is the very defect this column removes. `'user'` never hides
 * anything, so the rule is exact from the first award granted after this runs
 * and conservative before it.
 *
 * The `DEFAULT` is the whole backfill: `ADD COLUMN … NOT NULL DEFAULT 'user'`
 * writes it into every existing row in the same statement.
 */
const addSourceToUserTags = async () => {
  try {
    await db.query(`
      ALTER TABLE user_tags
        ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'user'
    `);

    // Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this migration runs on
    // every `npm run migrate` — so the guard is explicit. The value set is
    // closed and small, unlike `preferred_language`, which is a varchar on
    // purpose so that a new language stays a code change.
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'user_tags_source_check'
        ) THEN
          ALTER TABLE user_tags
            ADD CONSTRAINT user_tags_source_check
            CHECK (source IN ('user', 'award'));
        END IF;
      END $$;
    `);

    console.log("source column added to user_tags (or already exists)");
  } catch (error) {
    console.error("Error adding source to user_tags:", error);
    throw error;
  }
};

module.exports = addSourceToUserTags;
