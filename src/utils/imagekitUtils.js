const imagekit = require("../config/imagekit");

const IMAGEKIT_HOST = "ik.imagekit.io";

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

const deleteImageKitFile = async (url, fileId = null) => {
  if (!url && !fileId) {
    return false;
  }

  try {
    let resolvedFileId = fileId;

    if (!resolvedFileId) {
      if (!isImageKitUrl(url)) {
        return false;
      }

      const filename = extractImageKitFilename(url);

      if (!filename) {
        return false;
      }

      const response = await fetch(
        `https://api.imagekit.io/v1/files?searchQuery=${encodeURIComponent(`name="${filename}"`)}`,
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString(
                "base64",
              ),
          },
        },
      );

      if (!response.ok) {
        console.error("[ImageKit] Search API error:", response.status);
        return false;
      }

      const files = await response.json();

      if (!Array.isArray(files) || files.length === 0) {
        return false;
      }

      resolvedFileId = files[0].fileId;
    }

    await imagekit.files.delete(resolvedFileId);
    return true;
  } catch (error) {
    console.error("[ImageKit] Error deleting file:", error);
    return false;
  }
};

module.exports = {
  IMAGEKIT_HOST,
  isImageKitUrl,
  extractImageKitFilename,
  deleteImageKitFile,
};
