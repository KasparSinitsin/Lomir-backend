// The counting of scripts/count-orphaned-files.js (STATUS item 59): which
// ImageKit files does nothing in the database point at any more? Pure
// functions, so the counting is tested without ImageKit or a database.

const FOLDERS = ["/lomir/avatars/", "/lomir/team-avatars/", "/lomir/chat-images/", "/lomir/chat-files/"];
const DAY_MS = 24 * 60 * 60 * 1000;

const folderOf = (filePath) =>
  FOLDERS.find((folder) => typeof filePath === "string" && filePath.startsWith(folder)) || "other";

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return null;
  }
};

/**
 * @param {Array<{ url?: string|null, fileId?: string|null, queued?: boolean }>} references
 *   every file reference in the database; `queued` marks the deletion queue
 */
const indexReferences = (references) => {
  const index = { urls: new Set(), fileIds: new Set(), queuedUrls: new Set(), queuedFileIds: new Set() };
  for (const ref of references) {
    const url = ref.url ? normalizeUrl(ref.url) : null;
    if (ref.queued) {
      if (url) index.queuedUrls.add(url);
      if (ref.fileId) index.queuedFileIds.add(ref.fileId);
    } else {
      if (url) index.urls.add(url);
      if (ref.fileId) index.fileIds.add(ref.fileId);
    }
  }
  return index;
};

/**
 * Counts per folder: files, referenced, queued for deletion, and orphans by age.
 * A file younger than a day may still be on its way into a message or a
 * profile, so it is counted apart.
 */
const countOrphans = (files, references, now = Date.now()) => {
  const index = indexReferences(references);
  const result = {};
  for (const folder of [...FOLDERS, "other"]) {
    result[folder] = { files: 0, referenced: 0, queued: 0, orphanedUnderADay: 0, orphanedOlder: 0 };
  }

  for (const file of files) {
    const row = result[folderOf(file.filePath)];
    row.files += 1;
    const url = file.url ? normalizeUrl(file.url) : null;

    if (index.fileIds.has(file.fileId) || (url && index.urls.has(url))) {
      row.referenced += 1;
    } else if (index.queuedFileIds.has(file.fileId) || (url && index.queuedUrls.has(url))) {
      row.queued += 1;
    } else {
      const age = now - Date.parse(file.createdAt || 0);
      if (age < DAY_MS) row.orphanedUnderADay += 1;
      else row.orphanedOlder += 1;
    }
  }
  return result;
};

module.exports = { FOLDERS, folderOf, normalizeUrl, countOrphans };
