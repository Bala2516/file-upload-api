const mongoose = require("mongoose");

const AudioFileSchema = new mongoose.Schema({
  filename: String,
  original_name: String,
  filepath: String,
  size: Number,
  uploaded_by: String,
  uploaded_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AudioFile", AudioFileSchema);
