const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { escapeForPosixRegex } = require("../src/utils/escapeForPosixRegex");

/**
 * `deleteUser` deletes the notifications that name the deleted user rather than
 * rewriting them, and the reasons are measurements rather than preferences —
 * `lomir-docs-internal/deletion-audit/11-notifications-before-the-scrub.sql`:
 *
 *   · `notifications.actor_id` is ON DELETE SET NULL, so rows survive a deletion
 *     with the actor emptied and the NAME IN THE TEXT as the only identifier
 *   · `user_id` is ON DELETE CASCADE, so the user's own notifications need no
 *     handling at all
 *   · of 1826 `badge_awarded` rows only 117 carry the literal the current writer
 *     produces — the stored shapes are historical, so the anchored-prefix
 *     approach that makes the MESSAGE scrub safe cannot work here
 *   · ~1,500 rows name someone other than the actor, and
 *     `role_application_deferred_invite` is 52 of 52
 *
 * ⚠️ The controller is read as TEXT, never required: it imports
 * `config/database`, and `focusAreaProvenance.test.js` is the recorded case of
 * what requiring such a module costs — its first run put a
 * `REFRESH MATERIALIZED VIEW` on the production database. `escapeForPosixRegex`
 * lives in its own import-free module precisely so this file can exercise it
 * directly.
 */
const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const controllerSource = () =>
  readSource("src/controllers/userDeletionController.js");

test("the notification deletes run BEFORE the user row is deleted", () => {
  // 🔴 The load-bearing assertion of this file, and it is invisible in the SQL.
  // `actor_id` is ON DELETE SET NULL, so the moment `DELETE FROM users` runs,
  // every actor_id pointing at this user becomes NULL and the actor-based
  // delete matches NOTHING — with no error, just zero rows. The table already
  // holds ~400 rows with a NULL actor from deletions that predate this code,
  // which is what that failure looks like in the data.
  const source = controllerSource();

  const actorDelete = source.indexOf(
    "DELETE FROM notifications WHERE actor_id = $1",
  );
  const nameDelete = source.indexOf("DELETE FROM notifications\n        WHERE title ~");
  const userDelete = source.indexOf("DELETE FROM users WHERE id = $1");

  assert.ok(actorDelete > 0, "the actor-based notification delete is gone");
  assert.ok(nameDelete > 0, "the name-based notification delete is gone");
  assert.ok(userDelete > 0, "the user row delete moved or changed shape");

  assert.ok(
    actorDelete < userDelete,
    "the actor-based notification delete now runs AFTER `DELETE FROM users`. " +
      "Because notifications.actor_id is ON DELETE SET NULL, it will silently " +
      "match zero rows and every notification naming this user stays behind.",
  );
  assert.ok(
    nameDelete < userDelete,
    "the name-based notification delete now runs after `DELETE FROM users`",
  );
});

test("the user's own notifications are left to the CASCADE, not deleted by hand", () => {
  // `user_id` is ON DELETE CASCADE. A hand-written delete would be redundant,
  // and worse, it would read as if the cascade could not be relied on — which
  // is the kind of doubt that makes the next person add a third mechanism.
  const source = controllerSource();

  assert.doesNotMatch(
    source,
    /DELETE FROM notifications\s+WHERE user_id = \$1/,
    "a delete on notifications.user_id was added. That column is ON DELETE " +
      "CASCADE (deletion-audit/11 section A), so the rows go with the users " +
      "row in Phase E — if the schema changed, update the audit doc too.",
  );
});

test("the name match uses word boundaries, not a bare substring", () => {
  // 🔴 This is a DELETE, so a false positive destroys a third party's row. A
  // bare `position(name IN title) > 0` would let a deleted "Ana" take out every
  // notification about "Anastasia". The message scrub bounded the same hazard
  // with ` | ` delimiters; notification text is free prose and has none, so the
  // boundary has to be expressed as a regex.
  const source = controllerSource();

  // ⚠️ COUNTED, not merely present. The first version of this test asserted the
  // boundary groups existed somewhere in the file and a mutation then removed
  // them from the `title` comparison alone — which the test did not catch,
  // because the `message` comparison still had them. Both comparisons need
  // their own boundary or half the match is a bare substring.
  const leading = source.match(/\(\^\|\[\^\[:alnum:\]\]\)/g) || [];
  const trailing = source.match(/\(\[\^\[:alnum:\]\]\|\$\)/g) || [];

  assert.equal(
    leading.length,
    2,
    `expected a leading word boundary on BOTH the title and message ` +
      `comparisons, found ${leading.length}`,
  );
  assert.equal(
    trailing.length,
    2,
    `expected a trailing word boundary on BOTH comparisons, found ${trailing.length}`,
  );
  assert.match(
    source,
    /escapeForPosixRegex\(name\)/,
    "the name is no longer escaped before being interpolated into a regex",
  );
});

test("the actor-based delete is unconditional, because of renames", () => {
  // Deliberately NOT restricted to rows containing the name. A user who renamed
  // before deleting leaves notifications storing their OLD display name, which
  // no name match can find — the id is the only remaining link, and this is the
  // only statement that uses it.
  const source = controllerSource();

  assert.match(
    source,
    /`DELETE FROM notifications WHERE actor_id = \$1`/,
    "the actor-based delete gained a condition. If it now also requires the " +
      "name to be present, notifications storing a pre-rename name are " +
      "unreachable again — that is the case this statement exists for.",
  );
});

test("escapeForPosixRegex neutralises every POSIX metacharacter", () => {
  const cases = [
    ["A. B", "A\\. B"],
    ["A (admin)", "A \\(admin\\)"],
    ["x[1]", "x\\[1\\]"],
    ["a*b+c?", "a\\*b\\+c\\?"],
    ["^start", "\\^start"],
    ["end$", "end\\$"],
    ["a|b", "a\\|b"],
    ["a{2}", "a\\{2\\}"],
    ["back\\slash", "back\\\\slash"],
    ["Anna Berg", "Anna Berg"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(
      escapeForPosixRegex(input),
      expected,
      `escaping ${JSON.stringify(input)} produced the wrong pattern`,
    );
  }
});

test("escapeForPosixRegex escapes a backslash in the name itself", () => {
  // ⚠️ This test used to be called "escapes the backslash before anything else"
  // and claimed an ordering hazard. A mutation that moved `\` to the END of the
  // character class did not make it fail — correctly, because a single
  // `replace` with `$&` escapes each matched character exactly once and the
  // order within a class is meaningless. The real property is simply that a
  // backslash is escaped at all, so that a name containing one cannot produce
  // an invalid pattern.
  assert.equal(escapeForPosixRegex("\\."), "\\\\\\.");
  assert.equal(escapeForPosixRegex("a\\b"), "a\\\\b");
});

test("an escaped name matches itself on a word boundary and not inside a word", () => {
  // The property the SQL relies on, asserted directly with JS regex semantics.
  // POSIX classes are not available here, so this uses the equivalent \W form —
  // it checks the ESCAPING and the boundary idea, not the Postgres dialect.
  const name = "Ana";
  const pattern = new RegExp(`(^|\\W)${escapeForPosixRegex(name)}(\\W|$)`);

  assert.ok(pattern.test("Ana joined Team Alpha"), "should match the name itself");
  assert.ok(pattern.test("Welcome, Ana!"), "should match before punctuation");
  assert.ok(
    !pattern.test("Anastasia joined Team Alpha"),
    "🔴 matched inside a longer name — a deletion would hit the wrong person",
  );
  assert.ok(
    !pattern.test("Diana joined Team Alpha"),
    "🔴 matched at the end of a longer name",
  );
});

test("a name with regex metacharacters cannot match something it should not", () => {
  // `A.B` must not match `AxB`, which is exactly what an unescaped `.` would do.
  const pattern = new RegExp(`(^|\\W)${escapeForPosixRegex("A.B")}(\\W|$)`);

  assert.ok(pattern.test("A.B left the team"));
  assert.ok(
    !pattern.test("AxB left the team"),
    "the dot behaved as a wildcard — the name was not escaped",
  );
});
