const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BitcoinData = require("../models/BitcoinData");
const AudioFile = require("../models/AudioFile");
const VideoFile = require("../models/VideoFile");

const router = express.Router();

const ALGO = "aes-256-cbc";
const SECRET_KEY = Buffer.from(process.env.AES_SECRET_KEY, "hex");
const IV_LENGTH = 16;

const MAX_MEDIA_SIZE = 10 * 1024 * 1024; // 10MB
const AUDIO_EXTS = [".mp3"];
const VIDEO_EXTS = [".mp4"];

function encryptFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, SECRET_KEY, iv);

    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);

    output.write(iv);

    input.pipe(cipher).pipe(output);

    output.on("finish", () => resolve(true));
    output.on("error", reject);
  });
}

function getDynamicUploadPath(username) {
  const base = path.join(__dirname, "..", "uploads");

  const now = new Date();
  const dateFolder =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const finalPath = path.join(base, dateFolder, username);

  fs.mkdirSync(finalPath, { recursive: true });

  return finalPath;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const username = req.body.username || "UnknownUser";
    const uploadPath = getDynamicUploadPath(username);

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// Excel Parsing
function parseExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

// CSV Parsing
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", (err) => reject(err));
  });
}

// Parse Topics
function parseTopics(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((item) => {
      const match = item.trim().match(/(.+)\((.+)\)/);
      if (!match) return null;

      return {
        topic: match[1].trim(),
        relevance_score: match[2].trim(),
      };
    })
    .filter(Boolean);
}

// Parse Ticker Sentiment
function parseTickerSentiment(str) {
  if (!str) return [];
  return str
    .split(",")
    .map((item) => {
      const match = item.trim().match(/(.+)\((.+)\)/);
      if (!match) return null;

      return {
        ticker: match[1].trim(),
        ticker_sentiment_label: match[2].trim(),
        relevance_score: "",
        ticker_sentiment_score: "",
      };
    })
    .filter(Boolean);
}

// Upload Route
router.post("/upload", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ msg: "No files uploaded" });
    }

    const username = req.body.username || "UnknownUser";
    const results = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const filePath = file.path;
      const encryptedPath = filePath + ".enc";

      if (file.size === 0) {
        results.push({
          file: file.originalname,
          status: "error",
          message: "File is empty",
        });
        continue;
      }

      if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {

        if (file.size > MAX_MEDIA_SIZE) {
          fs.unlinkSync(file.path);
          results.push({
            file: file.originalname,
            status: "error",
            message: "Audio/Video size must be less than 10MB",
          });
          continue;
        }

        let savedDoc;

        if (AUDIO_EXTS.includes(ext)) {
          savedDoc = await AudioFile.create({
            filename: file.filename,
            original_name: file.originalname,
            filepath: filePath,
            size: file.size,
            uploaded_by: username,
          });
        } else {
          savedDoc = await VideoFile.create({
            filename: file.filename,
            original_name: file.originalname,
            filepath: filePath,
            size: file.size,
            uploaded_by: username,
          });
        }

        await encryptFile(filePath, encryptedPath);
        fs.unlinkSync(filePath);

        results.push({
          file: file.originalname,
          type: AUDIO_EXTS.includes(ext) ? "audio" : "video",
          status: "success",
          model_id: savedDoc._id,
          encrypted_file: path.basename(encryptedPath),
        });

        continue;
      }

      let jsonData = [];
      let fileType = "";

      if (ext === ".csv") {
        jsonData = await parseCSV(file.path);
        fileType = "csv";
      } else if (ext === ".xls" || ext === ".xlsx") {
        jsonData = parseExcel(file.path);
        fileType = "excel";
      } else {
        results.push({
          file: file.originalname,
          status: "error",
          message: "Invalid file type",
        });
        continue;
      }

      if (!jsonData.length) {
        results.push({
          file: file.originalname,
          status: "error",
          message: "File contains no data",
        });
        continue;
      }

      jsonData = jsonData.map((row) => ({
        ...row,
        topics: parseTopics(row.topics),
        ticker_sentiment: parseTickerSentiment(row.ticker_sentiment),
      }));

      const savedData = await BitcoinData.insertMany(jsonData);

      await encryptFile(filePath, encryptedPath);
      fs.unlinkSync(filePath);

      results.push({
        file: file.originalname,
        type: fileType,
        status: "success",
        encrypted_file: path.basename(encryptedPath),
        records_saved: savedData.length,
      });
    }

    res.json({
      message: "All files processed",
      total_files: req.files.length,
      results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      msg: "Server error while processing file",
      error: error.message,
    });
  }
});

module.exports = router;
