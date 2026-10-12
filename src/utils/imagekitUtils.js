const imagekit = require("../config/imagekit");

const IMAGEKIT_HOST = "ik.imagekit.io";
const SEARCH_TIMEOUT_MS = 15000;
const MAX_ERROR_LENGTH = 200;

// The outcome of one deletion attempt. DELETED, NOT_FOUND and SKIPPED all mean
// there is nothing left to delete: the file is gone, was never there, or the
// reference is not an ImageKit file at all. Only FAILED means the file may
// still exist, so only FAILED is worth another try later.
const DELETION_RESULT = Object.freeze({
  DELETED: "deleted",
  NOT_FOUND: "not_found",
  SKIPPED: "skipped",
  FAILED: "failed",
});

const isImageKitUrl = (url) =>
  typeof url === "string" && url.includes(IMAGEKIT_HOST);

const extractImageKitFilename = (url) => {
  if (!isImageKitUrl(url)) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const filename = parsedUrl.pathname.split("/").pop();

    return filename ? decodeURIComponent(filename) : null;
  } catch (error) {
    console.error("[ImageKit] Error extracting filename:", error);
    return null;
  }
};

const decodedPathname = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
};

// An error text short enough to store, without the file name: the queue keeps
// it for the operator, and a name can carry personal data.
const describeError = (error) =>
  String(error?.message || error || "unknown error").slice(0, MAX_ERROR_LENGTH);

// Finds the file id for an ImageKit URL through the search API.
//
// The search matches on the file NAME, which ImageKit makes unique with a
// random suffix at upload. Should several files still share the name, only
// the one whose `filePath` ends the URL's path qualifies; a name found in a
// different folder is reported as FAILED, not as NOT_FOUND, so that a wrong
// assumption about `filePath` stays visible as a retry instead of quietly
// dropping the deletion.
const findImageKitFileId = async (url) => {
  const filename = extractImageKitFilename(url);

  if (!filename) {
    return { result: DELETION_RESULT.SKIPPED };
  }

  const response = await fetch(
    `https://api.imagekit.io/v1/files?searchQuery=${encodeURIComponent(`name="${filename}"`)}`,
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64"),
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    return {
      result: DELETION_RESULT.FAILED,
      error: `search API status ${response.status}`,
    };
  }

  const files = await response.json();

  if (!Array.isArray(files)) {
    return { result: DELETION_RESULT.FAILED, error: "search API returned no list" };
  }

  if (files.length === 0) {
    return { result: DELETION_RESULT.NOT_FOUND };
  }

  const pathname = decodedPathname(url);
  const candidates = files.filter(
    (file) =>
      typeof file?.filePath !== "string" ||
      (pathname !== null && pathname.endsWith(file.filePath)),
  );

  if (candidates.length === 1 && candidates[0]?.fileId) {
    return { fileId: candidates[0].fileId };
  }

  return {
    result: DELETION_RESULT.FAILED,
    error:
      candidates.length === 0
        ? `name found ${files.length} time(s), but not at this path`
        : `name found ${candidates.length} times at this path`,
  };
};

/**
 * Deletes one ImageKit file and says what happened.
 *
 * Never throws. A file id wins over the URL; without one the URL is resolved
 * through the search API first.
 *
 * @returns {Promise<{ result: string, error?: string }>} result is one of DELETION_RESULT
 */
const deleteImageKitFileWithResult = async (url, fileId = null) => {
  if (!url && !fileId) {
    return { result: DELETION_RESULT.SKIPPED };
  }

  try {
    let resolvedFileId = fileId;

    if (!resolvedFileId) {
      if (!isImageKitUrl(url)) {
        return { result: DELETION_RESULT.SKIPPED };
      }

      const lookup = await findImageKitFileId(url);

      if (!lookup.fileId) {
        return lookup;
      }

      resolvedFileId = lookup.fileId;
    }

    try {
      await imagekit.files.delete(resolvedFileId);
    } catch (error) {
      if (error?.status === 404) {
        return { result: DELETION_RESULT.NOT_FOUND };
      }
      throw error;
    }

    return { result: DELETION_RESULT.DELETED };
  } catch (error) {
    console.error("[ImageKit] Error deleting file:", describeError(error));
    return { result: DELETION_RESULT.FAILED, error: describeError(error) };
  }
};

// Nothing is left to delete after this result.
const isDeletionSettled = (result) =>
  result === DELETION_RESULT.DELETED ||
  result === DELETION_RESULT.NOT_FOUND ||
  result === DELETION_RESULT.SKIPPED;

// The older yes/no form: true only when a file was actually deleted.
const deleteImageKitFile = async (url, fileId = null) => {
  const { result } = await deleteImageKitFileWithResult(url, fileId);
  return result === DELETION_RESULT.DELETED;
};

module.exports = {
  IMAGEKIT_HOST,
  DELETION_RESULT,
  isImageKitUrl,
  extractImageKitFilename,
  deleteImageKitFile,
  deleteImageKitFileWithResult,
  isDeletionSettled,
};
