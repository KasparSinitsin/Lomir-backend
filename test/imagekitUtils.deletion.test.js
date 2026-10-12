const test = require("node:test");
const assert = require("node:assert/strict");

const imagekit = require("../src/config/imagekit");
const {
  DELETION_RESULT,
  deleteImageKitFile,
  deleteImageKitFileWithResult,
  isDeletionSettled,
} = require("../src/utils/imagekitUtils");

// These tests must never reach ImageKit: the local .env holds real keys. Every
// test replaces both network seams, and the defaults below fail loudly if a
// test forgets one.
const originalFetch = global.fetch;
const originalDelete = imagekit.files.delete;

const URL_IN_CHAT_IMAGES =
  "https://ik.imagekit.io/demo123/lomir/chat-images/photo_AbC123.jpg";

function stubNetwork({ searchResponse, deleteImpl } = {}) {
  const calls = { search: [], delete: [] };

  global.fetch = async (url) => {
    calls.search.push(String(url));
    if (!searchResponse) {
      throw new Error("unexpected search call");
    }
    if (searchResponse instanceof Error) {
      throw searchResponse;
    }
    return searchResponse;
  };

  imagekit.files.delete = async (fileId) => {
    calls.delete.push(fileId);
    if (!deleteImpl) {
      throw new Error("unexpected delete call");
    }
    return deleteImpl(fileId);
  };

  return calls;
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test.afterEach(() => {
  global.fetch = async () => {
    throw new Error("network call outside a stub");
  };
  imagekit.files.delete = async () => {
    throw new Error("delete call outside a stub");
  };
});

test.after(() => {
  global.fetch = originalFetch;
  imagekit.files.delete = originalDelete;
});

test("no reference at all is skipped without any call", async () => {
  const calls = stubNetwork();
  assert.deepEqual(await deleteImageKitFileWithResult(null, null), {
    result: DELETION_RESULT.SKIPPED,
  });
  assert.deepEqual(calls, { search: [], delete: [] });
});

test("a URL outside ImageKit is skipped without any call", async () => {
  const calls = stubNetwork();
  const outcome = await deleteImageKitFileWithResult(
    "https://example.com/avatar.png",
  );
  assert.equal(outcome.result, DELETION_RESULT.SKIPPED);
  assert.deepEqual(calls, { search: [], delete: [] });
});

test("a file id is deleted directly, without a search", async () => {
  const calls = stubNetwork({ deleteImpl: async () => ({}) });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES, "file-1");
  assert.equal(outcome.result, DELETION_RESULT.DELETED);
  assert.deepEqual(calls.search, []);
  assert.deepEqual(calls.delete, ["file-1"]);
});

test("a URL is resolved by name and the file at its path is deleted", async () => {
  const calls = stubNetwork({
    searchResponse: jsonResponse([
      { fileId: "file-2", filePath: "/lomir/chat-images/photo_AbC123.jpg" },
    ]),
    deleteImpl: async () => ({}),
  });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.DELETED);
  assert.equal(calls.search.length, 1);
  assert.ok(
    decodeURIComponent(calls.search[0]).includes('name="photo_AbC123.jpg"'),
  );
  assert.deepEqual(calls.delete, ["file-2"]);
});

test("a file without filePath in the answer is still deleted when it is the only one", async () => {
  const calls = stubNetwork({
    searchResponse: jsonResponse([{ fileId: "file-3" }]),
    deleteImpl: async () => ({}),
  });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.DELETED);
  assert.deepEqual(calls.delete, ["file-3"]);
});

test("of two files with the same name only the one at the URL's path is deleted", async () => {
  const calls = stubNetwork({
    searchResponse: jsonResponse([
      { fileId: "elsewhere", filePath: "/lomir/avatars/photo_AbC123.jpg" },
      { fileId: "here", filePath: "/lomir/chat-images/photo_AbC123.jpg" },
    ]),
    deleteImpl: async () => ({}),
  });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.DELETED);
  assert.deepEqual(calls.delete, ["here"]);
});

test("a name found only in another folder is FAILED, not NOT_FOUND, and nothing is deleted", async () => {
  const calls = stubNetwork({
    searchResponse: jsonResponse([
      { fileId: "elsewhere", filePath: "/lomir/avatars/photo_AbC123.jpg" },
    ]),
  });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.FAILED);
  assert.deepEqual(calls.delete, []);
});

test("two candidates at the same path are FAILED, and nothing is deleted", async () => {
  const calls = stubNetwork({
    searchResponse: jsonResponse([{ fileId: "a" }, { fileId: "b" }]),
  });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.FAILED);
  assert.deepEqual(calls.delete, []);
});

test("an empty search answer is NOT_FOUND", async () => {
  const calls = stubNetwork({ searchResponse: jsonResponse([]) });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.NOT_FOUND);
  assert.deepEqual(calls.delete, []);
});

test("a failing search is FAILED, and the error does not carry the file name", async () => {
  stubNetwork({ searchResponse: jsonResponse({}, 500) });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.FAILED);
  assert.match(outcome.error, /500/);
  assert.ok(!outcome.error.includes("photo_AbC123"));
});

test("a network error during the search is FAILED, never thrown", async () => {
  stubNetwork({ searchResponse: new Error("socket hang up") });
  const outcome = await deleteImageKitFileWithResult(URL_IN_CHAT_IMAGES);
  assert.equal(outcome.result, DELETION_RESULT.FAILED);
  assert.match(outcome.error, /socket hang up/);
});

test("a 404 from the delete call is NOT_FOUND", async () => {
  stubNetwork({
    deleteImpl: async () => {
      const error = new Error("404 File not found");
      error.status = 404;
      throw error;
    },
  });
  const outcome = await deleteImageKitFileWithResult(null, "file-gone");
  assert.equal(outcome.result, DELETION_RESULT.NOT_FOUND);
});

test("any other error from the delete call is FAILED", async () => {
  stubNetwork({
    deleteImpl: async () => {
      const error = new Error("429 Too many requests");
      error.status = 429;
      throw error;
    },
  });
  const outcome = await deleteImageKitFileWithResult(null, "file-busy");
  assert.equal(outcome.result, DELETION_RESULT.FAILED);
  assert.match(outcome.error, /429/);
});

test("the yes/no form is true only for an actual deletion", async () => {
  stubNetwork({ deleteImpl: async () => ({}) });
  assert.equal(await deleteImageKitFile(null, "file-4"), true);

  stubNetwork({ searchResponse: jsonResponse([]) });
  assert.equal(await deleteImageKitFile(URL_IN_CHAT_IMAGES), false);
});

test("deleted, not found and skipped are settled; failed is not", () => {
  assert.equal(isDeletionSettled(DELETION_RESULT.DELETED), true);
  assert.equal(isDeletionSettled(DELETION_RESULT.NOT_FOUND), true);
  assert.equal(isDeletionSettled(DELETION_RESULT.SKIPPED), true);
  assert.equal(isDeletionSettled(DELETION_RESULT.FAILED), false);
});
