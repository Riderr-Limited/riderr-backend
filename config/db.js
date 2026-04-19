import mongoose from "mongoose";

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  throw new Error("Please define the MONGODB_URL environment variable");
}

const connectToDatabase = async () => {
  try {
    await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });
    console.log("✅ Connected to database");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    process.exit(1);
  }
};

export default connectToDatabase;
