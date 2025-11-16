const express = require("express");
const multer = require("multer");
const csv = require("csv-parser");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const BitcoinData = require("../models/BitcoinData");

const router = express.Router();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer Storage Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
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

// Parse Topics:  "AI(0.92), Crypto(0.88)"
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

// Parse Ticker Sentiment: "BTC(Bullish), ETH(Neutral)"
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
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ msg: "No file uploaded" });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let jsonData = [];

    // Detect file type & parse
    if (ext === ".csv") {
      jsonData = await parseCSV(req.file.path);
    } else if (ext === ".xls" || ext === ".xlsx") {
      jsonData = parseExcel(req.file.path);
    } else {
      return res.status(400).json({ msg: "Only CSV or Excel files allowed" });
    }

    if (!jsonData.length)
      return res.status(400).json({ msg: "No valid data found in the file" });

    console.log("Parsed Data:", jsonData);

    // Transform each record to include parsed fields
    jsonData = jsonData.map((row) => ({
      ...row,
      topics: parseTopics(row.topics),
      ticker_sentiment: parseTickerSentiment(row.ticker_sentiment),
    }));

    const savedData = await BitcoinData.insertMany(jsonData);

    res.json({
      message: "File uploaded & data stored successfully",
      total_records: savedData.length,
      stored_data: savedData,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    res.status(500).json({
      msg: "Server error while processing file",
      error: error.message,
    });
  }
});

module.exports = router;
