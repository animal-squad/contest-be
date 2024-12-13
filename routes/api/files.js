// backend/routes/api/files.js
const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const fileController = require("../../controllers/fileController");
const { upload, errorHandler } = require("../../middleware/upload");

// 파일 업로드
router.post(
  "/upload",
  auth,
  upload.single("file"),
  errorHandler,
  fileController.uploadFile
);

// 파일 다운로드
router.get("/download/:filename", auth, fileController.downloadFile);

// 파일 보기 (미리보기용)
router.get("/view/:filename", auth, fileController.viewFile);

// 파일 삭제
router.delete("/:id", auth, fileController.deleteFile);

// // Presigned URL request
// router.post("/url", auth);

// Presigned URL 생성 API
router.post("/presigned-url", fileController.generatePresignedUrl);
router.post("/profile-presigned-url", fileController.generateProfileUrl);
router.post("/profile-complete", fileController.profileUploadComplete);

module.exports = router;
