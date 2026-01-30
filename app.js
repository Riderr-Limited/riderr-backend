import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoSanitize from "express-mongo-sanitize";
import apiRoutes from "./routes/index.route.js";
import newDriverRoutes from "./routes/newDriver.routes.js";
import newDeliveryRoutes from "./routes/newDelivery.routes.js";

const app = express();

/**
 * CORS Configuration - MUST COME FIRST
 */
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'https://riderr.ng',
      'https://www.riderr.ng',
      'https://riderrr.vercel.app',
      'https://api.riderr.vercel.app',
      "https://api.riderrr.vercel.app",
      "https://api.riderr.ng/api",
      "https://riderr-backend.onrender.com/api",
      // Add your actual deployed backend URL
      process.env.FRONTEND_URL,
      process.env.CLIENT_URL
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24 hours
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
 * Body Parser Middleware
 */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/**
 * Data Sanitization
 */
// Prevent NoSQL injection

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
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Debug endpoint for deployment
 */
app.get('/api/debug', (req, res) => {
  res.json({
    success: true,
    environment: process.env.NODE_ENV,
    port: process.env.PORT,
    frontendUrl: process.env.FRONTEND_URL,
    backendUrl: process.env.BACKEND_URL,
    corsOrigins: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://riderr.ng',
      'https://www.riderr.ng',
      'https://riderrr.vercel.app',
      process.env.FRONTEND_URL,
      process.env.CLIENT_URL
    ].filter(Boolean),
    requestOrigin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

/**
 * Test endpoint
 */
app.get('/api/test-cors', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    origin: req.headers.origin,
    method: req.method
  });
});

app.post('/api/test-cors', (req, res) => {
  console.log('Test CORS POST received:', req.body);
  res.json({
    success: true,
    message: 'POST request successful',
    data: req.body,
    origin: req.headers.origin
  });
});

/**
 * API Routes
 */
app.use("/api", apiRoutes);
app.use("/api/drivers", newDriverRoutes);
app.use("/api/deliveries", newDeliveryRoutes);

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
  console.error("❌ Error:", err);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Origin not allowed by CORS',
      origin: req.headers.origin,
      allowedOrigins: ['http://localhost:3000', 'http://localhost:3001']
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
