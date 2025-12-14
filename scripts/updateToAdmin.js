// scripts/updateToAdmin.js
import mongoose from "mongoose";
import User from "../models/user.models.js";
import dotenv from "dotenv";

dotenv.config();

const updateToAdmin = async () => {
  try {
    console.log("🔗 Connecting to MongoDB...");
    
    await mongoose.connect(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/riderr_db");
    
    console.log("✅ MongoDB connected");
    
    // Find the user
    const user = await User.findOne({ email: "admin@system.com" });
    
    if (!user) {
      console.log("❌ User not found");
      return;
    }
    
    console.log("Current role:", user.role);
    
    // Update to admin
    user.role = "admin";
    await user.save();
    
    console.log("\n✅ USER UPDATED TO ADMIN!");
    console.log("Email:", user.email);
    console.log("New role:", user.role);
    console.log("\n⚠️  You need to login again to get new token with admin role");
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
};

updateToAdmin();