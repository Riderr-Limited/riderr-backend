import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import companyRegistrationRoutes from "./routes/companyRegistration.routes.js";
 import companyRoutes from "./routes/company.routes.js";
import deliveryRoutes from "./routes/delivery.routes.js";
  
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URL || "mongodb://localhost:27017/riderr_db")
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/company-registrations", companyRegistrationRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/deliveries", deliveryRoutes);  
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
      company_registrations: "/api/company-registrations",
      companies: "/api/companies",
      deliveries: "/api/deliveries",
      health: "/api/health"
    }
  });
});

// Root
app.get("/", (req, res) => {
  res.json({ 
    success: true,
    message: "Riderr Backend API", 
    version: "1.0.0",
    documentation: "/api"
  });
});

  

// Error handler
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`
🚀 Server running on port ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🔗 Local: http://localhost:${PORT}
🔗 API: http://localhost:${PORT}/api
🔗 Health: http://localhost:${PORT}/api/health
`)
);