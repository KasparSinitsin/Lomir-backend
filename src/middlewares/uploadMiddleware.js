const multer = require("multer");
const imagekit = require("../config/imagekit");

const storage = multer.memoryStorage();

const uploadToImageKit = async (
  fileBuffer,
  fileName,
  folder = "lomir/avatars",
) => {
  const response = await imagekit.upload({
    file: fileBuffer.toString("base64"),
    fileName,
    folder,
  });

  return response;
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB file size limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.",
        ),
        false,
      );
    }
  },
});

module.exports = {
  upload,
  uploadToImageKit,
};
