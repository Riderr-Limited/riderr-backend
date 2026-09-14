import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";
import apiRoutes from "./routes/index.route.js";
import newDriverRoutes from "./routes/newDriver.routes.js";
import newDeliveryRoutes from "./routes/newDelivery.routes.js";
import testRoutes from "./routes/test.routes.js";

const app = express();

/**
 * CORS Configuration - MUST COME FIRST
 */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "https://riderr.ng",
      "https://www.riderr.ng",
      "https://riderrr.vercel.app",
      "https://api.riderr.vercel.app",
      "https://api.riderrr.vercel.app",
      "https://api.riderr.ng/api",
      "https://riderr-backend.onrender.com/api",
      "https://riderr-backend.onrender.com",
      "http://10.44.168.181:5000",
      "https://logiq-admin-riderr.riderr.ng",
      "https://admin-rider.vercel.app",

      // Add your actual deployed backend URL
      process.env.FRONTEND_URL,
      process.env.CLIENT_URL,
    ].filter(Boolean);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400, // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests explicitly

/**
 * Security Middleware
 */
app.use(helmet());
app.set("trust proxy", true);

/**
 * Global Rate Limiter — all routes
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});
app.use(globalLimiter);

/**
 * Body Parser Middleware
 */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

/**
 * NoSQL Injection Prevention
 */
app.use(mongoSanitize());

/**
 * Logging
 */
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

/**
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * API Docs
 */
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
app.get("/api/docs.json", (req, res) => res.json(swaggerSpec));

/**
 * API Routes
 */
app.use("/api", apiRoutes);
app.use("/api/drivers", newDriverRoutes);
app.use("/api/deliveries", newDeliveryRoutes);
app.use("/api/test", testRoutes); // Email testing routes

/**
 * Root Route
 */
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Riderr API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      rides: "/api/rides",
      health: "/api/health",
    },
  });
});

/**
 * 404 Handler
 */

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error(" Error:", err);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed by CORS",
      origin: req.headers.origin,
      allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && {
      error: err.message,
      stack: err.stack,
    }),
  });
});

export default app;
