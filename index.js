import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import compression from "compression";

// Import routes
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";

// Load environment variables
dotenv.config();

const app = express();

// ================== DATABASE CONNECTION ==================

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URL || "mongodb://localhost:27017/delivery_service");
    
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB error:', err);
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// ================== SECURITY MIDDLEWARE ==================

// Basic helmet (simplified)
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests, please try again later."
});

app.use("/api/", limiter);

// Stronger rate limiting for auth
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: "Too many login attempts, please try again later."
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);

// ================== BODY PARSING ==================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Data sanitization
app.use(mongoSanitize());

// ================== PERFORMANCE ==================

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ================== ROUTES ==================

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is healthy",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

// API info
app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Delivery Service API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      health: "/api/health"
    }
  });
});

// Root
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Delivery Service API",
    documentation: "Visit /api for API information"
  });
});

// ================== ERROR HANDLING ==================

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { error: err.stack })
  });
});

// ================== START SERVER ==================

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
      🚀 Server running on port ${PORT}
      🌍 Environment: ${process.env.NODE_ENV || 'development'}
      🔗 API URL: http://localhost:${PORT}/api
      🔗 Health: http://localhost:${PORT}/api/health
    `);
  });
}).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

export default app;