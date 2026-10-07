// The legacy-marker id migration rewrites STORED MESSAGE TEXT on 171 production
// rows, so its rule is pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The eight prefixes must be the ones the writers emit. A glyph typed
//      without its variation selector looks identical and matches NOTHING, so
//      the migration would report "0 rows" and look healthy.
//   2. The sender slot must be 2 for seven formats and 3 for INVITATION_DECLINED.
//      Swapping that one writes the RECEIVER's id on the sender's name — the
//      same shape of error as BE #352, one layer down.
//   3. The population must be UNTOKENISED rows, sent before the cutoff, in DMs.
//      That guard is what makes a second run a no-op.
//   4. A slot that matches a DIFFERENT living user must be left alone, and both
//      second sources (reviewed_by, inviter) must be able to veto a row.
//   5. The rebuild must reproduce the stored content exactly, or the rewrite could
//      change a byte it did not mean to.
//   6. `\s` and `\d` in a JS template literal are just `s` and `d`. The SQL must
//      carry `\\s`, or every pattern would match a literal letter and the
//      migration would silently touch nothing.
//   7. It must own a transaction, verify itself and refuse an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   8. It must name its DRY RUN (`STATUS.md` habit 11).
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool. Behaviour against real rows was checked on a
// throwaway postgres with `deletion-audit/fixtures/32-fixture.sql`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { NAME_BEARING_MESSAGE_FORMATS } = require("../src/config/nameBearingMessageFormats");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/add_person_ids_to_legacy_marker_dms.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

// [prefix, slots, senderSlot] triples, read out of the FORMATS literal.
const formatsBlock = source.slice(source.indexOf("const FORMATS = ["), source.indexOf("];") + 2);
const formats = [...formatsBlock.matchAll(/\["([^"]+)", (\d+), (\d+)\]/g)].map((m) => ({
  prefix: m[1],
  slots: Number(m[2]),
  senderSlot: Number(m[3]),
}));

test("there are exactly the eight formats of deletion-audit/29", () => {
  assert.deepEqual(
    formats.map((f) => f.prefix.replace(/^\S+ /, "")).sort(),
    [
      "APPLICATION_APPROVED:",
      "APPLICATION_CANCELLED:",
      "APPLICATION_DECLINED:",
      "INVITATION_CANCELLED:",
      "INVITATION_DECLINED:",
      "MEMBER_REMOVED:",
      "OWNERSHIP_TRANSFERRED:",
      "ROLE_CHANGED:",
    ],
  );
});

test("every prefix is byte-for-byte what the scrub config builds from emoji + marker", () => {
  const known = new Set(
    NAME_BEARING_MESSAGE_FORMATS.filter((f) => f.marker).map((f) => `${f.emoji} ${f.marker}:`),
  );
  for (const { prefix } of formats) {
    assert.ok(
      known.has(prefix),
      `${JSON.stringify(prefix)} is not an emoji + marker pair in nameBearingMessageFormats.js — ` +
        "compare code points, not glyphs",
    );
  }
});

test("the sender slot is 2 everywhere except INVITATION_DECLINED, where it is 3", () => {
  for (const f of formats) {
    const expected = f.prefix.includes("INVITATION_DECLINED:") ? 3 : 2;
    assert.equal(f.senderSlot, expected, f.prefix);
  }
});

test("each format's slot count matches what its writer emits", () => {
  const expected = {
    "ROLE_CHANGED:": 5,
    "APPLICATION_APPROVED:": 4,
    "APPLICATION_DECLINED:": 4,
    "INVITATION_DECLINED:": 4,
    "INVITATION_CANCELLED:": 3,
    "MEMBER_REMOVED:": 3,
    "OWNERSHIP_TRANSFERRED:": 3,
    "APPLICATION_CANCELLED:": 3,
  };
  for (const f of formats) {
    assert.equal(f.slots, expected[f.prefix.replace(/^\S+ /, "")], f.prefix);
  }
});

test("the population is untokenised DMs sent before the cutoff", () => {
  assert.ok(source.includes("WHERE m.team_id IS NULL"));
  assert.ok(source.includes("AND m.sent_at < '2026-01-15'"));
  assert.ok(source.includes("NOT (regexp_replace(m.content, '^[^:]*:\\\\s*', '') ~ '(^|\\\\|\\\\s*)\\\\d+\\\\s*:')"));
});

test("a row is rewritten only when both person slots are safe", () => {
  assert.ok(source.includes("p.sender_id IS NOT NULL"));
  assert.ok(source.includes("p.receiver_id IS NOT NULL"));
  // equals the assigned user's current name OR matches nobody living
  assert.equal((source.match(/OR \(SELECT count\(\*\) FROM un WHERE un\.name = p\.(sender|receiver)_txt\) = 0/g) || []).length, 2);
});

test("both second sources can veto a row", () => {
  assert.ok(source.includes("ta.reviewed_by IS NOT NULL AND ta.reviewed_by <> p.sender_id"));
  assert.ok(source.includes("ti.inviter_id <> p.receiver_id"));
  assert.ok(source.includes("ti.invitee_id = p.sender_id AND ti.status = 'declined'"));
});

test("the rewrite must reproduce the stored content before it writes", () => {
  assert.ok(source.includes("p.head || array_to_string(p.slots, ' | ') = p.content"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("only the id is added, in front of the stored name", () => {
  assert.ok(source.includes("p.sender_id::text   || ':' || s.val"));
  assert.ok(source.includes("p.receiver_id::text || ':' || s.val"));
  assert.ok(source.includes("5 - p.sender_slot"));
});

test("regexes are written with doubled backslashes", () => {
  const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));
  assert.ok(!/[^\\]\\s/.test(sql), "a single-backslash \\s would be read as a literal s");
  assert.ok(!/[^\\]\\d/.test(sql), "a single-backslash \\d would be read as a literal d");
  assert.ok(sql.includes("\\\\s+"));
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.ok(source.includes('"BEGIN"'));
  assert.ok(source.includes('"COMMIT"'));
  assert.ok(source.includes('"ROLLBACK"'));
  assert.ok(source.includes("REMAINING_SQL"));
  assert.ok(source.includes("result.rowCount > MAX_ROWS"));
  assert.ok(source.includes("const MAX_ROWS = 171"));
  assert.ok(source.includes("const EXPECTED_ROWS = 167"));
});

test("it names its dry run", () => {
  assert.ok(source.includes("deletion-audit/32"));
});

test("it is registered, and after the approver correction", () => {
  const a = index.indexOf("await fixWrongApproverIdsInApplauseEvents();");
  const b = index.indexOf("await addPersonIdsToLegacyMarkerDms();");
  assert.ok(a !== -1 && b !== -1, "both migrations must be called");
  assert.ok(b > a, "the id migration runs after the approver correction");
});
