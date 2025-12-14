import mongoose from "mongoose";
import bcrypt from "bcrypt";
import User from "../models/user.models.js";
import dotenv from "dotenv";

dotenv.config();

const createFreshAdmin = async () => {
  try {
    console.log("🔗 Creating fresh admin user...");
    
    await mongoose.connect(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/riderr_db");
    
    // Delete old admin if exists
    await User.deleteOne({ email: "freshadmin@system.com" });
    
    // Hash password
    const password = "Admin@123";
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new admin
    const admin = await User.create({
      name: "Fresh Admin",
      email: "freshadmin@system.com",
      password: hashedPassword,
      phone: "+1234567000",
      role: "admin",
      isVerified: true,
      isActive: true,
      companyId: null
    });
    
    console.log("\n🎉 FRESH ADMIN CREATED!");
    console.log("=========================");
    console.log("Email: freshadmin@system.com");
    console.log("Password: Admin@123");
    console.log("Phone: +1234567000");
    console.log("Role: admin");
    console.log("=========================");
    
    // Verify the password was saved
    const savedUser = await User.findOne({ email: "freshadmin@system.com" }).select('+password');
    console.log("\n✅ Verification:");
    console.log("Password saved:", !!savedUser.password);
    console.log("Password is bcrypt hash:", savedUser.password.startsWith('$2b$'));
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
};

createFreshAdmin();