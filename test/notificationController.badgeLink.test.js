const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const {
  getNavigationUrl,
  getUnreadCount,
} = require("../src/controllers/notificationController");

const BADGES = "/profile?scrollTo=badges";
const badge = (extra) => ({
  type: "badge_awarded",
  team_id: null,
  reference_type: "badge_award",
  reference_id: 1,
  actor_id: 2,
  title: null,
  badge_name: null,
  ...extra,
});

test("the badge name comes from the reference, not from the title", () => {
  assert.equal(
    getNavigationUrl(badge({ badge_name: "Mentor", title: "New Badge: Coder" })),
    `${BADGES}&highlightBadge=Mentor`,
  );
});

test("a title of the form 'New Badge: X' is the fallback when the reference gives no name", () => {
  assert.equal(
    getNavigationUrl(badge({ title: "New Badge: Quick Learner" })),
    `${BADGES}&highlightBadge=Quick%20Learner`,
  );
});

test("a title that is not of that form never becomes a highlight", () => {
  for (const title of [
    "You earned a badge",
    "Badge received: Coder",
    "Reminder New Badge: Coder",
    "",
    null,
    undefined,
  ]) {
    assert.equal(getNavigationUrl(badge({ title })), BADGES, String(title));
  }
});

test("the name is URL-encoded", () => {
  assert.equal(
    getNavigationUrl(badge({ badge_name: "Q&A / Co" })),
    `${BADGES}&highlightBadge=Q%26A%20%2F%20Co`,
  );
});

test("both queries behind a badge link resolve the name through the stored reference", async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (text) => {
    queries.push(text);
    if (text.includes("first_unread_json")) {
      return { rows: [{ count: "0", first_unread_json: null }] };
    }
    return { rows: [] };
  };
  try {
    await getUnreadCount(
      { user: { id: 1 } },
      { status() { return this; }, json() {} },
    );
  } finally {
    db.query = originalQuery;
  }
  const withName = queries.filter((q) => q.includes("badge_name"));
  assert.equal(withName.length, 2, "first unread and oldest per type");
  for (const q of withName) {
    assert.match(q, /WHEN 'badge' THEN/);
    assert.match(q, /WHEN 'badge_award' THEN/);
    assert.match(q, /FROM badge_awards ba_ref/);
  }
});
