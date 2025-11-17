const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const uploadRoute = require("./routes/upload");

const app = express();

async function connectToDatabase() {
  try {
    await mongoose.connect("mongodb://127.0.0.1:27017/fileupload");
    console.log("Database connection successful");
  } catch (err) {
    console.error("Database connection error:", err);
  }
}
connectToDatabase();

app.use("/api", uploadRoute);

app.listen(3000, () => console.log("Server running on 3000"));
