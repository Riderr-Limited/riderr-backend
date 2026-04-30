import mongoose from "mongoose";
import { setServers } from 'dns';
setServers(['8.8.8.8', '8.8.4.4']);
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
 dotenv.config();
import app from "./app.js";


import { setupDeliverySocket } from "./socket/deliverySocket.js";
import { setupVoiceCallSocket } from "./socket/voiceCallSocket.js";
import supportSocket from "./socket/supportSocket.js";
import adminChatSocket from "./socket/adminChatSocket.js";
import startAutoExpireJob from "./jobs/autoExpireDeliveries.js";

import path from "path";
import { fileURLToPath } from "url";
import express from "express"; 




 const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = process.env.PORT || 5000;
const MONGODB_URL =
  process.env.MONGODB_URL || "mongodb://localhost:27017/riderr";

/**
 * Connect to MongoDB
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGODB_URL);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("🔄 MongoDB reconnected");
    });
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
    console.error("💡 Make sure MongoDB is running and accessible");
    process.exit(1);
  }
};

/**
 * Graceful shutdown
 */
const gracefulShutdown = async (server, io) => {
  console.log("🛑 Received shutdown signal, closing connections...");

  try {
    // Close Socket.IO connections
    if (io) {
      io.close(() => {
        console.log("✅ Socket.IO connections closed");
      });
    }

    // Close HTTP server
    if (server) {
      server.close(() => {
        console.log("✅ HTTP server closed");
      });
    }

    // Close MongoDB connection
    await mongoose.connection.close();
    console.log("✅ MongoDB connection closed");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
};

/**
 * Start Server
 */
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Create HTTP server from Express app
    const httpServer = createServer(app);

    // Initialize Socket.IO with CORS configuration
    const io = new Server(httpServer, {
      cors: {
        origin: [
          "http://localhost:3000",
          "http://localhost:3001", 
          "https://riderr.ng",
          "https://www.riderr.ng",
          "https://riderrr.vercel.app",
          "https://riderr-backend.onrender.com",
          "http://10.44.168.181:5000",
          process.env.FRONTEND_URL,
          process.env.CLIENT_URL,
        ].filter(Boolean),
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
      },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Setup delivery, voice call, support, and admin chat socket events
    setupDeliverySocket(io);
    setupVoiceCallSocket(io);
    supportSocket(io);
    adminChatSocket(io);
    console.log(
      "✅ Socket.IO initialized and all socket namespaces setup complete",
    );

    // Start background jobs
    startAutoExpireJob();

    // Store io instance BEFORE server starts so controllers can access it
    app.set("io", io);

    // Start the server
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log("\n" + "=".repeat(60));
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`📡 API available at: http://localhost:${PORT}/api`);
      console.log(`🔧 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔌 WebSocket available at: ws://localhost:${PORT}`);
      console.log(`📁 Uploads available at: http://localhost:${PORT}/uploads`);
      console.log(`📞 Voice calls enabled with WebRTC`);
    });

    // Handle server errors
    httpServer.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use`);
      } else {
        console.error("❌ Server error:", error);
      }
      process.exit(1);
    });

    // Handle graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown(httpServer, io));
    process.on("SIGINT", () => gracefulShutdown(httpServer, io));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled Rejection:", error);
  process.exit(1);
});

// Start the server
startServer();
