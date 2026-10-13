// POST /api/users/resolve-names - the endpoint that lets the client show the
// name a mention id displays under TODAY, instead of the one frozen into the
// stored message text.
//
// 🔴 What these tests actually guard. "This account is deleted" is inferred
// from an id being ABSENT from `people`, because `deleteUser` hard-deletes the
// users row and leaves no flag behind. That inference is only sound while
// absence has exactly one cause, so the endpoint reports `requested` - the ids
// it really looked up - beside the results. Every test below is about keeping
// those two populations distinguishable; if they blur, living people start
// rendering as "Former Lomir User".
const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const userController = require("../src/controllers/userController");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

test("resolveDisplayNames returns the survivors and omits the deleted id", async () => {
  db.query = async (sql, params) => {
    assert.ok(sql.includes("ANY($1::int[])"));
    // 7 survives, 99 was deleted - the query simply finds no row for it.
    assert.deepEqual(params[0], [7, 99]);
    return {
      rows: [
        { id: 7, first_name: "Anna", last_name: "Kowalski", username: "anna" },
      ],
    };
  };

  const res = createResponse();
  await userController.resolveDisplayNames(
    { body: { ids: [7, 99] }, user: { id: 1 } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.requested, [7, 99]);
  assert.equal(res.body.data.people.length, 1);
  assert.equal(res.body.data.people[0].id, 7);
  assert.equal(res.body.data.people[0].firstName, "Anna");
  // The deleted one is absent rather than carrying a placeholder name: the
  // label is the client's to translate, and a wire-level English name is the
  // DELETED_USER_DISPLAY_NAME trap.
  assert.ok(!res.body.data.people.some((p) => p.id === 99));
  // ...and it IS in `requested`, which is what makes the absence readable.
  assert.ok(res.body.data.requested.includes(99));
});

test("a non-numeric mention id is dropped from requested, not reported as deleted", async () => {
  // `@all` stores the literal "all" (MentionChip special-cases it), so a
  // non-numeric id is ordinary input here.
  db.query = async (_sql, params) => {
    assert.deepEqual(params[0], [7]);
    return { rows: [{ id: 7, first_name: "Anna", last_name: "K", username: "anna" }] };
  };

  const res = createResponse();
  await userController.resolveDisplayNames(
    { body: { ids: ["all", "7", "", null] }, user: { id: 1 } },
    res,
  );

  assert.deepEqual(res.body.data.requested, [7]);
  // 🔴 The load-bearing assertion: "all" must NOT be in `requested`. If it
  // were, the client would find it missing from `people` and anonymize a
  // mention that addresses the whole team.
  assert.ok(!res.body.data.requested.includes("all"));
});

test("duplicate ids are collapsed", async () => {
  db.query = async (_sql, params) => {
    assert.deepEqual(params[0], [7]);
    return { rows: [{ id: 7, first_name: "Anna", last_name: "K", username: "anna" }] };
  };

  const res = createResponse();
  await userController.resolveDisplayNames(
    { body: { ids: [7, "7", 7] }, user: { id: 1 } },
    res,
  );

  assert.deepEqual(res.body.data.requested, [7]);
});

test("the batch is capped, and the ids past the cap stay out of requested", async () => {
  let queried = null;
  db.query = async (_sql, params) => {
    queried = params[0];
    return { rows: [] };
  };

  const ids = Array.from({ length: 250 }, (_, i) => i + 1);
  const res = createResponse();
  await userController.resolveDisplayNames({ body: { ids }, user: { id: 1 } }, res);

  assert.equal(queried.length, 200);
  assert.equal(res.body.data.requested.length, 200);
  // 🔴 Id 201 was never looked up, so it must not look deleted. The client
  // falls back to the stored name for anything outside `requested`.
  assert.ok(!res.body.data.requested.includes(201));
  assert.ok(res.body.data.requested.includes(200));
});

test("a missing or non-array ids field is a 400, not an empty success", async () => {
  db.query = async () => {
    throw new Error("the query must not run for a malformed body");
  };

  for (const body of [{}, { ids: "7" }, { ids: null }, undefined]) {
    const res = createResponse();
    await userController.resolveDisplayNames({ body, user: { id: 1 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  }
});

test("an empty array answers 200 with nothing requested and never queries", async () => {
  db.query = async () => {
    throw new Error("the query must not run for an empty id list");
  };

  const res = createResponse();
  await userController.resolveDisplayNames(
    { body: { ids: [] }, user: { id: 1 } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.requested, []);
  assert.deepEqual(res.body.data.people, []);
});
