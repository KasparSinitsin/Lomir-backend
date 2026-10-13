// The ImageKit listing and the database references shared by
// scripts/count-orphaned-files.js and scripts/delete-orphaned-files.js
// (STATUS item 59). `fetch` is read at call time, so the callers' read-only
// guard or fake listing is what answers.

const PAGE = 1000;
const MAX_PAGES = 200;

const listAllFiles = async () => {
  const auth = "Basic " + Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64");
  const files = [];
  const seenFirst = new Set();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await globalThis.fetch(
      `https://api.imagekit.io/v1/files?type=file&limit=${PAGE}&skip=${page * PAGE}`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) throw new Error(`ImageKit list API answered ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("ImageKit list API returned no list");
    if (batch.length > 0) {
      // A page that starts with a file already seen means `skip` is not honoured.
      if (seenFirst.has(batch[0].fileId)) throw new Error("the listing does not advance (skip not honoured); stopped");
      seenFirst.add(batch[0].fileId);
    }
    files.push(...batch);
    if (batch.length < PAGE) return files;
  }
  throw new Error(`more than ${MAX_PAGES * PAGE} files; stopped`);
};

const BASE_REFERENCES_SQL = `
  SELECT avatar_url AS url, avatar_file_id AS file_id, false AS queued FROM users
    WHERE avatar_url IS NOT NULL OR avatar_file_id IS NOT NULL
  UNION ALL
  SELECT teamavatar_url, teamavatar_file_id, false FROM teams
    WHERE teamavatar_url IS NOT NULL OR teamavatar_file_id IS NOT NULL
  UNION ALL
  SELECT image_url, NULL, false FROM messages WHERE image_url IS NOT NULL
  UNION ALL
  SELECT file_url, NULL, false FROM messages WHERE file_url IS NOT NULL
`;
// The deletion queue exists only once `migrate:one create_pending_file_deletions`
// has run; before that it is counted as empty.
const QUEUE_REFERENCES_SQL = `
  UNION ALL
  SELECT file_url, file_id, true FROM pending_file_deletions
`;

const hostOf = (url) => {
  try {
    return new URL(url).hostname || "(no host)";
  } catch {
    return "(unreadable DATABASE_URL)";
  }
};

module.exports = { listAllFiles, BASE_REFERENCES_SQL, QUEUE_REFERENCES_SQL, hostOf };
