// Counting the ImageKit files nothing points at (STATUS item 59). Pure logic;
// the real run on a throwaway database with a fake listing:
// deletion-audit/fixtures/90-count-orphaned-files-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");

const { countOrphans, folderOf } = require("../scripts/orphans/countOrphans");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const OLD = "2026-08-01T00:00:00Z";
const FRESH = "2026-10-12T08:00:00Z";
const IK = "https://ik.imagekit.io/demo123";

test("files land in their folder; anything else is other", () => {
  assert.equal(folderOf("/lomir/avatars/a.png"), "/lomir/avatars/");
  assert.equal(folderOf("/lomir/chat-files/b.pdf"), "/lomir/chat-files/");
  assert.equal(folderOf("/somewhere/c.png"), "other");
  assert.equal(folderOf(undefined), "other");
});

test("referenced by id or by URL, queued, and orphaned by age are told apart", () => {
  const files = [
    { fileId: "f1", filePath: "/lomir/avatars/a_1.png", url: `${IK}/lomir/avatars/a_1.png`, createdAt: OLD },
    { fileId: "f2", filePath: "/lomir/chat-images/my photo_2.jpg", url: `${IK}/lomir/chat-images/my%20photo_2.jpg`, createdAt: OLD },
    { fileId: "f3", filePath: "/lomir/chat-files/q_3.pdf", url: `${IK}/lomir/chat-files/q_3.pdf`, createdAt: OLD },
    { fileId: "f4", filePath: "/lomir/chat-files/orphan_4.pdf", url: `${IK}/lomir/chat-files/orphan_4.pdf`, createdAt: OLD },
    { fileId: "f5", filePath: "/lomir/chat-images/fresh_5.jpg", url: `${IK}/lomir/chat-images/fresh_5.jpg`, createdAt: FRESH },
    { fileId: "f6", filePath: "/elsewhere/x_6.png", url: `${IK}/elsewhere/x_6.png`, createdAt: OLD },
    { fileId: "f7", filePath: "/lomir/team-avatars/t_7.png", url: `${IK}/lomir/team-avatars/t_7.png`, createdAt: OLD },
  ];
  const references = [
    { url: null, fileId: "f1" },
    { url: `${IK}/lomir/chat-images/my%20photo_2.jpg?tr=w-200` },
    { url: `${IK}/lomir/chat-files/q_3.pdf`, queued: true },
    { url: `${IK}/lomir/team-avatars/t_7.png`, fileId: null },
    { url: "https://example.com/not-imagekit.png" },
  ];

  const result = countOrphans(files, references, NOW);

  assert.deepEqual(result["/lomir/avatars/"], { files: 1, referenced: 1, queued: 0, orphanedUnderADay: 0, orphanedOlder: 0 });
  assert.deepEqual(result["/lomir/chat-images/"], { files: 2, referenced: 1, queued: 0, orphanedUnderADay: 1, orphanedOlder: 0 });
  assert.deepEqual(result["/lomir/chat-files/"], { files: 2, referenced: 0, queued: 1, orphanedUnderADay: 0, orphanedOlder: 1 });
  assert.deepEqual(result["/lomir/team-avatars/"], { files: 1, referenced: 1, queued: 0, orphanedUnderADay: 0, orphanedOlder: 0 });
  assert.deepEqual(result.other, { files: 1, referenced: 0, queued: 0, orphanedUnderADay: 0, orphanedOlder: 1 });
});

test("a file referenced AND queued counts as referenced (it is still in use)", () => {
  const files = [{ fileId: "f1", filePath: "/lomir/avatars/a.png", url: `${IK}/lomir/avatars/a.png`, createdAt: OLD }];
  const result = countOrphans(files, [{ fileId: "f1" }, { fileId: "f1", queued: true }], NOW);
  assert.equal(result["/lomir/avatars/"].referenced, 1);
  assert.equal(result["/lomir/avatars/"].queued, 0);
});
