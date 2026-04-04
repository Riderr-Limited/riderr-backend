import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import readline from "readline";
import User from "../models/user.models.js";
import dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const run = async () => {
  // Collect all inputs BEFORE connecting to DB to avoid mongoose warnings interrupting prompts
  const name     = (await ask("Name:     ")).trim();
  const email    = (await ask("Email:    ")).trim();
  const phone    = (await ask("Phone:    ")).trim();
  const password = (await ask("Password: ")).trim();
  rl.close();

  console.log("\nConnecting to database...");
  await mongoose.connect(process.env.MONGODB_URL);

  const existing = await User.findOne({ $or: [{ email }, { phone }] });
  if (existing) {
    console.log(`⚠️  User with that email or phone already exists.`);
    process.exit(0);
  }

  const admin = await User.create({
    name,
    email,
    phone,
    password: await bcrypt.hash(password, 10),
    role: "admin",
    isVerified: true,
    isActive: true,
  });

  console.log(`\n✅ Super Admin created: ${admin.name} <${admin.email}>`);
  console.log("⚠️  Change the password after first login!");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
