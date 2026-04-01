import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/user.models.js";

dotenv.config();

const ADMIN = {
  name: "Riderr Super Admin",
  email: "admin@riderr.ng",
  phone: "+2348000000001",
  password: "Riderr@Admin2025",
  role: "admin",
  isVerified: true,
  isActive: true,
};

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/riderr_db");
    console.log("🔗 Connected to database");

    const existing = await User.findOne({ email: ADMIN.email });
    if (existing) {
      console.log("⚠️  Admin already exists:", ADMIN.email);
      return;
    }

    const hashedPassword = await bcrypt.hash(ADMIN.password, 10);

    await User.create({ ...ADMIN, password: hashedPassword });

    console.log("\n✅ Super Admin created successfully!");
    console.log("================================");
    console.log("  Email   :", ADMIN.email);
    console.log("  Password:", ADMIN.password);
    console.log("  Role    :", ADMIN.role);
    console.log("================================");
    console.log("⚠️  Change the password after first login!\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
  }
};

createAdmin();
