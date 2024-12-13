const File = require("../models/File");
const User = require("../models/User");
const Message = require("../models/Message");
const Room = require("../models/Room");
const { processFileForRAG } = require("../services/fileService");
const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const crypto = require("crypto");
const { uploadDir } = require("../middleware/upload");
const AWS = require("aws-sdk");
const multer = require("multer");

const fsPromises = {
  writeFile: promisify(fs.writeFile),
  unlink: promisify(fs.unlink),
  access: promisify(fs.access),
  mkdir: promisify(fs.mkdir),
  rename: promisify(fs.rename),
};

const isPathSafe = (filepath, directory) => {
  const resolvedPath = path.resolve(filepath);
  const resolvedDirectory = path.resolve(directory);
  return resolvedPath.startsWith(resolvedDirectory);
};

const generateSafeFilename = (originalFilename) => {
  const ext = path.extname(originalFilename || "").toLowerCase();
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString("hex");
  return `${timestamp}_${randomBytes}${ext}`;
};

// 개선된 파일 정보 조회 함수
const getFileFromRequest = async (req) => {
  try {
    const filename = req.params.filename;
    const token = req.headers["x-auth-token"] || req.query.token;
    const sessionId = req.headers["x-session-id"] || req.query.sessionId;

    if (!filename) {
      throw new Error("Invalid filename");
    }

    if (!token || !sessionId) {
      throw new Error("Authentication required");
    }

    const filePath = path.join(uploadDir, filename);
    if (!isPathSafe(filePath, uploadDir)) {
      throw new Error("Invalid file path");
    }

    await fsPromises.access(filePath, fs.constants.R_OK);

    const file = await File.findOne({ filename: filename });
    if (!file) {
      throw new Error("File not found in database");
    }

    // 채팅방 권한 검증을 위한 메시지 조회
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      throw new Error("File message not found");
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id,
    });

    if (!room) {
      throw new Error("Unauthorized access");
    }

    return { file, filePath };
  } catch (error) {
    console.error("getFileFromRequest error:", {
      filename: req.params.filename,
      error: error.message,
    });
    throw error;
  }
};

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "파일이 선택되지 않았습니다.",
      });
    }

    const safeFilename = generateSafeFilename(req.file.originalname);
    const currentPath = req.file.path;
    const newPath = path.join(uploadDir, safeFilename);

    const file = new File({
      filename: safeFilename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      user: req.user.id,
      path: newPath,
    });

    await file.save();
    await fsPromises.rename(currentPath, newPath);

    res.status(200).json({
      success: true,
      message: "파일 업로드 성공",
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate,
      },
    });
  } catch (error) {
    console.error("File upload error:", error);
    if (req.file?.path) {
      try {
        await fsPromises.unlink(req.file.path);
      } catch (unlinkError) {
        console.error("Failed to delete uploaded file:", unlinkError);
      }
    }
    res.status(500).json({
      success: false,
      message: "파일 업로드 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { file, filePath } = await getFileFromRequest(req);
    const contentDisposition = file.getContentDisposition("attachment");

    res.set({
      "Content-Type": file.mimetype,
      "Content-Length": file.size,
      "Content-Disposition": contentDisposition,
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", (error) => {
      console.error("File streaming error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "파일 스트리밍 중 오류가 발생했습니다.",
        });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    handleFileError(error, res);
  }
};

exports.viewFile = async (req, res) => {
  try {
    const { file, filePath } = await getFileFromRequest(req);

    if (!file.isPreviewable()) {
      return res.status(415).json({
        success: false,
        message: "미리보기를 지원하지 않는 파일 형식입니다.",
      });
    }

    const contentDisposition = file.getContentDisposition("inline");

    res.set({
      "Content-Type": file.mimetype,
      "Content-Disposition": contentDisposition,
      "Content-Length": file.size,
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", (error) => {
      console.error("File streaming error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "파일 스트리밍 중 오류가 발생했습니다.",
        });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    handleFileError(error, res);
  }
};

const handleFileStream = (fileStream, res) => {
  fileStream.on("error", (error) => {
    console.error("File streaming error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "파일 스트리밍 중 오류가 발생했습니다.",
      });
    }
  });

  fileStream.pipe(res);
};

const handleFileError = (error, res) => {
  console.error("File operation error:", {
    message: error.message,
    stack: error.stack,
  });

  // 에러 상태 코드 및 메시지 매핑
  const errorResponses = {
    "Invalid filename": { status: 400, message: "잘못된 파일명입니다." },
    "Authentication required": { status: 401, message: "인증이 필요합니다." },
    "Invalid file path": { status: 400, message: "잘못된 파일 경로입니다." },
    "File not found in database": {
      status: 404,
      message: "파일을 찾을 수 없습니다.",
    },
    "File message not found": {
      status: 404,
      message: "파일 메시지를 찾을 수 없습니다.",
    },
    "Unauthorized access": {
      status: 403,
      message: "파일에 접근할 권한이 없습니다.",
    },
    ENOENT: { status: 404, message: "파일을 찾을 수 없습니다." },
  };

  const errorResponse = errorResponses[error.message] || {
    status: 500,
    message: "파일 처리 중 오류가 발생했습니다.",
  };

  res.status(errorResponse.status).json({
    success: false,
    message: errorResponse.message,
  });
};

// AWS 설정
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY, // AWS Access Key
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // AWS Secret Key
  region: "ap-northeast-2",
});

// Presigned URL 요청 함수
exports.generatePresignedUrl = async (req, res) => {
  try {
    // 유니크한 파일 키 생성 (Timestamp + 랜덤 문자열)
    const fileKey = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    // 클라이언트에서 전달받은 파일 메타데이터 (예: 파일명, MIME 타입 등)
    const { originalname, mimetype, size } = req.body.fileData || {};

    if (!originalname || !mimetype || !size) {
      return res.status(400).json({
        success: false,
        message: "파일 메타데이터가 누락되었습니다.",
      });
    }

    // Presigned URL 요청 파라미터
    const params = {
      Bucket: process.env.BUCKET_KEY,
      Key: fileKey,
      Expires: 600, // Presigned URL 유효기간 (초 단위)
      ContentType: mimetype, // 파일 MIME 타입
    };

    // S3로부터 Presigned URL 생성
    const url = await s3.getSignedUrlPromise("putObject", params);

    // MongoDB에 파일 메타데이터 저장
    const filePath = `https://${process.env.BUCKET_KEY}.s3.ap-northeast-2.amazonaws.com/${fileKey}`;

    const fileDoc = new File({
      filename: fileKey,
      originalname,
      mimetype,
      size,
      user: userId,
      path: filePath,
    });

    await fileDoc.save();

    // 클라이언트에 URL 반환
    return res.status(200).json({
      URL: url,
      file: {
        _id: fileDoc._id,
        filename: fileDoc.filename,
        originalname: fileDoc.originalname,
        mimetype: fileDoc.mimetype,
        size: fileDoc.size,
        path: fileDoc.path,
      },
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return res.status(500).json({
      success: false,
      message: "Presigned URL 생성 중 오류가 발생했습니다.",
    });
  }
};

// 프로필 이미지 Presigned URL 생성
const upload = multer(); // 메모리 스토리지를 사용

exports.generateProfileUrl = async (req, res) => {
  try {
    const { name, email } = req.body;

    // 필수 데이터 확인
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "필수 데이터가 누락되었습니다.",
      });
    }

    // 사용자 존재 여부 확인 (이메일로 조회)
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // 유니크한 파일 키 생성
    const fileKey = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    // Presigned URL 생성
    const params = {
      Bucket: process.env.BUCKET_KEY,
      Key: fileKey,
      Expires: 600, // URL 유효기간 (초 단위)
      ContentType: "image/jpeg", // 기본 MIME 타입
    };

    const presignedUrl = await s3.getSignedUrlPromise("putObject", params);

    // 클라이언트에 Presigned URL 및 파일 키 반환
    return res.status(200).json({
      success: true,
      fileKey,
      presignedUrl,
    });
  } catch (error) {
    console.error("Error generating Presigned URL:", error);
    return res.status(500).json({
      success: false,
      message: "Presigned URL 생성 중 오류가 발생했습니다.",
    });
  }
};

exports.profileUploadComplete = async (req, res) => {
  try {
    const { name, email, fileKey } = req.body;

    // 필수 데이터 확인
    if (!name || !email || !fileKey) {
      return res.status(400).json({
        success: false,
        message: "필수 데이터가 누락되었습니다.",
      });
    }

    // 사용자 존재 여부 확인 (이메일로 조회)
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // 파일 경로 생성
    const filePath = `${process.env.CDN_PATH}/${fileKey}`;

    // 프로필 이미지 업데이트
    existingUser.profileImage = filePath;
    await existingUser.save();

    // 클라이언트에 성공 응답
    return res.status(200).json({
      success: true,
      message: "프로필 이미지가 성공적으로 업데이트되었습니다.",
      user: {
        id: existingUser._id,
        name: existingUser.name,
        email: existingUser.email,
        profileImage: existingUser.profileImage,
      },
    });
  } catch (error) {
    console.error("Error completing profile upload:", error);
    return res.status(500).json({
      success: false,
      message: "프로필 이미지 업데이트 중 오류가 발생했습니다.",
    });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);

    if (!file) {
      return res.status(404).json({
        success: false,
        message: "파일을 찾을 수 없습니다.",
      });
    }

    if (file.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "파일을 삭제할 권한이 없습니다.",
      });
    }

    const filePath = path.join(uploadDir, file.filename);

    if (!isPathSafe(filePath, uploadDir)) {
      return res.status(403).json({
        success: false,
        message: "잘못된 파일 경로입니다.",
      });
    }

    try {
      await fsPromises.access(filePath, fs.constants.W_OK);
      await fsPromises.unlink(filePath);
    } catch (unlinkError) {
      console.error("File deletion error:", unlinkError);
    }

    await file.deleteOne();

    res.json({
      success: true,
      message: "파일이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("File deletion error:", error);
    res.status(500).json({
      success: false,
      message: "파일 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};
