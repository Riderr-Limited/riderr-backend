import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes/index.route.js';
import newDriverRoutes from './routes/newDriver.routes.js';
import newDeliveryRoutes from './routes/newDelivery.routes.js';

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
      'http://127.0.0.1:3001'
    ];
    
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

// Custom NoSQL injection protection (alternative to express-mongo-sanitize)
app.use((req, res, next) => {
  // Sanitize request body
  const sanitize = (obj) => {
    if (obj && typeof obj === 'object') {
      for (const key in obj) {
        if (key.startsWith('$') || key.includes('.')) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          sanitize(obj[key]);
        }
      }
    }
    return obj;
  };

  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS'
});

app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many authentication attempts, please try again later.',
  skip: (req) => req.method === 'OPTIONS'
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

/**
 * Body Parser Middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Logging
 */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
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
app.use('/api', apiRoutes);
app.use('/api/drivers', newDriverRoutes);
app.use('/api/deliveries', newDeliveryRoutes);

/**
 * Root Route
 */
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Riderr API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      testCors: '/api/test-cors'
    }
  });
});

/**
 * 404 Handler
 */
 

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Origin not allowed by CORS',
      origin: req.headers.origin,
      allowedOrigins: ['http://localhost:3000', 'http://localhost:3001']
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && {
      error: err.message,
      stack: err.stack
    })
  });
});

export default app;