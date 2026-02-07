import mongoose from "mongoose";
import app from "../app.js";

let cachedConnection = null;

const connectDB = async () => {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log("Using cached MongoDB connection");
    return cachedConnection;
  }

  try {
    const MONGODB_URL = process.env.MONGODB_URL;
    
    if (!MONGODB_URL) {
      throw new Error("MONGODB_URL is not defined in environment variables");
    }

    const conn = await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    cachedConnection = conn;
    console.log("✅ MongoDB Connected:", conn.connection.host);
    return conn;
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
    throw error;
  }
};

export default async function handler(req, res) {
  try {
    await connectDB();
    return app(req, res);
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error in authentication",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
}
