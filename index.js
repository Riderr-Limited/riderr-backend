import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// MongoDB Connection (Mongoose 7+)
mongoose.connect(process.env.MONGODB_URL)
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });

// Routes
app.use("/api/v1/auth", authRoutes);

// Test route
app.get("/", (req, res) => {
  res.json({ message: "API running successfully ✔" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
