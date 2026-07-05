const test = require("node:test");
const assert = require("node:assert/strict");

const { buildReplyTo } = require("../src/utils/replySnapshot");

test("buildReplyTo returns null when there is no reply", () => {
  assert.equal(buildReplyTo(null), null);
  assert.equal(buildReplyTo(undefined), null);
  assert.equal(buildReplyTo({ reply_to_message_id: null }), null);
});

test("buildReplyTo maps the media fields so quoted image/file previews render for every viewer", () => {
  // Regression guard: the snapshot must carry image/file/expiry, not just
  // id/content/sender — otherwise a reply to an image-only message shows as
  // "Original message was deleted" for non-author viewers.
  const row = {
    reply_to_message_id: 42,
    reply_to_content: "hello",
    reply_to_sender_id: 7,
    reply_to_sender_username: "anna",
    reply_to_sender_first_name: "Anna",
    reply_to_image_url: "https://ik.imagekit.io/lomir/chat-images/x.jpg",
    reply_to_file_url: "https://ik.imagekit.io/lomir/chat-files/y.pdf",
    reply_to_file_name: "y.pdf",
    reply_to_file_size: 1234,
    reply_to_file_expires_at: "2026-07-11T00:00:00.000Z",
    reply_to_file_deleted_at: null,
    reply_to_deleted_at: null,
  };

  assert.deepEqual(buildReplyTo(row), {
    id: 42,
    content: "hello",
    senderId: 7,
    senderUsername: "anna",
    senderFirstName: "Anna",
    imageUrl: "https://ik.imagekit.io/lomir/chat-images/x.jpg",
    fileUrl: "https://ik.imagekit.io/lomir/chat-files/y.pdf",
    fileName: "y.pdf",
    fileSize: 1234,
    fileExpiresAt: "2026-07-11T00:00:00.000Z",
    fileDeletedAt: null,
    deletedAt: null,
  });
});

test("buildReplyTo trims content to 150 chars and preserves deletedAt", () => {
  const longContent = "a".repeat(300);
  const result = buildReplyTo({
    reply_to_message_id: 1,
    reply_to_content: longContent,
    reply_to_deleted_at: "2026-07-04T10:00:00.000Z",
  });

  assert.equal(result.content.length, 150);
  assert.equal(result.deletedAt, "2026-07-04T10:00:00.000Z");
});

test("buildReplyTo keeps null content as null (deleted original)", () => {
  const result = buildReplyTo({
    reply_to_message_id: 1,
    reply_to_content: null,
    reply_to_deleted_at: "2026-07-04T10:00:00.000Z",
  });

  assert.equal(result.content, null);
});
