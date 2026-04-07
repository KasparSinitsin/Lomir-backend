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

const deleteImageKitFile = async (url) => {
  if (!isImageKitUrl(url)) {
    return false;
  }

  try {
    const filename = extractImageKitFilename(url);

    if (!filename) {
      return false;
    }

    const files = await imagekit.listFiles({
      searchQuery: `name="${filename}"`,
    });

    if (!Array.isArray(files) || files.length === 0) {
      return false;
    }

    await imagekit.deleteFile(files[0].fileId);
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
