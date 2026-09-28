const { pool } = require("../config/database");

const ensureBadgeVisibilityColumns = async (clientOrPool = pool) => {
  await clientOrPool.query(
    `ALTER TABLE users
     ADD COLUMN IF NOT EXISTS hide_badges BOOLEAN DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS hidden_badge_ids INTEGER[] DEFAULT '{}'::INTEGER[],
     ADD COLUMN IF NOT EXISTS hidden_award_ids INTEGER[] DEFAULT '{}'::INTEGER[]`,
  );
};

/**
 * Badge visibility is a promise the UI makes in those words — "Hide badge from
 * others", "Hide this badge award from others? You will still see it on your
 * profile with a closed-eye marker" — so it has to hold on every path that
 * shows a named user's awards to someone else, not only on the profile.
 *
 * It did not. Every read path re-implemented the filter inline, and a new one
 * could omit it without anything failing: the search result list served the
 * awards a user had switched off (found 2026-09-27, user 373), and the team
 * badge wall honoured the per-award switch but not the whole-section one.
 * These builders are the single place the rule lives now. Use them instead of
 * writing the condition again.
 *
 * Two switches, both columns on `users`:
 *   `hide_badges`      — the whole section, every award at once
 *   `hidden_award_ids` — single awards, by `badge_awards.id`
 *
 * `viewerIsOwnerExpr` is SQL that is TRUE when the viewer is the person the
 * awards belong to; the owner always sees their own hidden awards, which is
 * what the closed-eye marker is for. Pass a placeholder (`"$2::BOOLEAN"`), a
 * comparison (`"ba.awarded_to_user_id = $2"`) or leave it out where no viewer
 * is known. A NULL viewer id makes the expression NULL, not TRUE, so an
 * unknown viewer is treated as a stranger rather than as the owner.
 */
const visibleAwardCondition = ({
  awardAlias = "ba",
  userAlias = "u",
  viewerIsOwnerExpr = "FALSE",
} = {}) => `(
          (${viewerIsOwnerExpr}) = TRUE
          OR (
            COALESCE(${userAlias}.hide_badges, FALSE) = FALSE
            AND NOT (${awardAlias}.id = ANY(COALESCE(${userAlias}.hidden_award_ids, '{}'::INTEGER[])))
          )
        )`;

/**
 * The credit total a viewer may see, as a SELECT-list expression. Correlates on
 * `<userAlias>.id`, so the aliased `users` row has to be in scope.
 */
const visibleBadgeCreditsSQL = ({
  userAlias = "u",
  viewerIsOwnerExpr = "FALSE",
} = {}) => `COALESCE((
      SELECT SUM(ba_vis.credits)
      FROM badge_awards ba_vis
      WHERE ba_vis.awarded_to_user_id = ${userAlias}.id
        AND ${visibleAwardCondition({
          awardAlias: "ba_vis",
          userAlias,
          viewerIsOwnerExpr,
        })}
    ), 0)`;

/**
 * The credits an owner has that are **not** shown to others, as a SELECT-list
 * expression. Julia's rule, 2026-09-28: credits count towards a total only once
 * the award is visible, so these are the ones waiting — what the UI shows muted,
 * with the closed eye that already means "not visible to others" everywhere else.
 *
 * ⚠️ **Visibility is the criterion, not a separate confirmation flag.** A new
 * award starts hidden so the recipient can confirm it, and hiding a long-confirmed
 * award again puts it back in exactly this bucket. That is deliberate (Julia,
 * 2026-09-28): what is not shown does not count, whatever the reason. It is also
 * why the UI should say "not visible" rather than "unconfirmed" — the database
 * cannot tell those apart and does not need to.
 *
 * Always zero for a stranger, because they never see the awards in the first
 * place. That keeps the payload one shape for both viewers.
 */
const hiddenBadgeCreditsSQL = ({ userAlias = "u" } = {}) => `COALESCE((
      SELECT SUM(ba_hid.credits)
      FROM badge_awards ba_hid
      WHERE ba_hid.awarded_to_user_id = ${userAlias}.id
        AND NOT ${visibleAwardCondition({
          awardAlias: "ba_hid",
          userAlias,
        })}
    ), 0)`;

/**
 * The badge list a viewer may see, as a SELECT-list expression yielding the
 * JSON array shape the frontend renders (`id`, `name`, `category`, `color`,
 * `cat_image_url`, the per-badge totals and the per-category totals).
 *
 * Aggregated from `badge_awards` rather than from
 * `v_user_badges_with_category_totals`, because the view aggregates awards into
 * per-badge totals before any visibility rule can be applied: hiding one award
 * of a badge has to lower that badge's credits, and hiding the only one has to
 * drop the badge entirely, neither of which the view can express. Reading the
 * awards also means search no longer serves that materialized view's stale
 * totals (`HANDOVER-Privacy-Security-Hardening.md`, open finding 4).
 *
 * **`total_credits` and `award_count` count only what is shown to others**, for
 * the owner too, because credits count towards a total only once the award is
 * visible (Julia, 2026-09-28). What is waiting comes alongside as
 * `hidden_credits` / `hidden_award_count`, per badge and per category, so the
 * owner's own view can render a badge whose every award is still hidden — muted,
 * with the credits it *would* add — instead of leaving it out and losing the only
 * hint that something is there. For a stranger those awards never enter the CTE,
 * so the hidden fields are 0 and the payload keeps one shape for both viewers.
 */
const visibleBadgesJsonSQL = ({
  userAlias = "u",
  viewerIsOwnerExpr = "FALSE",
} = {}) => `(
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', badge_rows.badge_id,
            'name', badge_rows.badge_name,
            'category', badge_rows.category,
            'color', badge_rows.badge_color,
            'cat_image_url', badge_rows.cat_image_url,
            'total_credits', badge_rows.total_credits,
            'award_count', badge_rows.award_count,
            'awarder_count', badge_rows.awarder_count,
            'hidden_credits', badge_rows.hidden_credits,
            'hidden_award_count', badge_rows.hidden_award_count,
            'category_total_credits', badge_rows.category_total_credits,
            'category_award_count', badge_rows.category_award_count,
            'category_awarder_count', badge_rows.category_awarder_count,
            'category_hidden_credits', badge_rows.category_hidden_credits,
            'category_hidden_award_count', badge_rows.category_hidden_award_count,
            'last_awarded_at', badge_rows.last_awarded_at
          )
          ORDER BY
            badge_rows.category_total_credits DESC,
            badge_rows.category ASC,
            badge_rows.total_credits DESC,
            badge_rows.badge_name ASC
        ),
        '[]'::json
      )
      FROM (
        WITH own_awards AS (
          SELECT
            ba_vis.id,
            ba_vis.badge_id,
            ba_vis.credits,
            ba_vis.awarded_by_user_id,
            ba_vis.created_at,
            b.name AS badge_name,
            b.category,
            b.color AS badge_color,
            b.cat_image_url,
            -- Shown to others, which is what decides whether the credits count.
            ${visibleAwardCondition({
              awardAlias: "ba_vis",
              userAlias,
            })} AS shown
          FROM badge_awards ba_vis
          JOIN badges b ON b.id = ba_vis.badge_id
          WHERE ba_vis.awarded_to_user_id = ${userAlias}.id
            AND ${visibleAwardCondition({
              awardAlias: "ba_vis",
              userAlias,
              viewerIsOwnerExpr,
            })}
        ),
        badge_totals AS (
          SELECT
            badge_id,
            badge_name,
            category,
            badge_color,
            cat_image_url,
            COALESCE(SUM(credits) FILTER (WHERE shown), 0)::INT AS total_credits,
            COUNT(*) FILTER (WHERE shown)::INT AS award_count,
            COUNT(DISTINCT awarded_by_user_id) FILTER (WHERE shown)::INT AS awarder_count,
            COALESCE(SUM(credits) FILTER (WHERE NOT shown), 0)::INT AS hidden_credits,
            COUNT(*) FILTER (WHERE NOT shown)::INT AS hidden_award_count,
            MAX(created_at) AS last_awarded_at
          FROM own_awards
          GROUP BY badge_id, badge_name, category, badge_color, cat_image_url
        ),
        category_totals AS (
          SELECT
            category,
            COALESCE(SUM(credits) FILTER (WHERE shown), 0)::INT AS category_total_credits,
            COUNT(*) FILTER (WHERE shown)::INT AS category_award_count,
            COUNT(DISTINCT awarded_by_user_id) FILTER (WHERE shown)::INT AS category_awarder_count,
            COALESCE(SUM(credits) FILTER (WHERE NOT shown), 0)::INT AS category_hidden_credits,
            COUNT(*) FILTER (WHERE NOT shown)::INT AS category_hidden_award_count
          FROM own_awards
          GROUP BY category
        )
        SELECT
          bt.*,
          ct.category_total_credits,
          ct.category_award_count,
          ct.category_awarder_count,
          ct.category_hidden_credits,
          ct.category_hidden_award_count
        FROM badge_totals bt
        JOIN category_totals ct ON ct.category = bt.category
      ) badge_rows
    )`;

/**
 * A focus area carries the badge awards linked to it — the award modal offers
 * "Link your award to one of {name}'s Focus Areas" — so hiding an award has to
 * take its focus area with it (Julia's rule, 2026-09-28). Otherwise the row
 * stays on the profile with its credits missing, which is the same inference
 * the search-list leak allowed.
 *
 * A focus area stays visible when nothing about it is hidden: either it has no
 * linked award at all, or at least one linked award is still shown, which is
 * evidence enough on its own. It disappears only when every award linked to it
 * is hidden. `userAlias` is the `users` row the focus area belongs to.
 */
const visibleFocusAreaCondition = ({
  userAlias = "u",
  tagAlias = "t",
  viewerIsOwnerExpr = "FALSE",
} = {}) => `(
          (${viewerIsOwnerExpr}) = TRUE
          OR NOT EXISTS (
            SELECT 1
            FROM badge_awards ba_link
            WHERE ba_link.tag_id = ${tagAlias}.id
              AND ba_link.awarded_to_user_id = ${userAlias}.id
          )
          OR EXISTS (
            SELECT 1
            FROM badge_awards ba_link_vis
            WHERE ba_link_vis.tag_id = ${tagAlias}.id
              AND ba_link_vis.awarded_to_user_id = ${userAlias}.id
              AND ${visibleAwardCondition({
                awardAlias: "ba_link_vis",
                userAlias,
                viewerIsOwnerExpr,
              })}
          )
        )`;

module.exports = {
  ensureBadgeVisibilityColumns,
  visibleAwardCondition,
  visibleBadgeCreditsSQL,
  hiddenBadgeCreditsSQL,
  visibleBadgesJsonSQL,
  visibleFocusAreaCondition,
};
