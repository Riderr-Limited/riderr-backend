import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import apiRoutes from './routes/index.route.js';
import newDriverRoutes from './routes/newDriver.routes.js';
import newDeliveryRoutes from './routes/newDelivery.routes.js';

const app = express();

/**
 * Security Middleware
 */

// Helmet for security headers
app.use(helmet());

  

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes
app.use('/api/', limiter);

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again later.'
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

/**
 * Body Parser Middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Data Sanitization
 */
// Prevent NoSQL injection
 
/**
 * Logging
 */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

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
      users: '/api/users',
      rides: '/api/rides',
      health: '/api/health'
    }
  });
});

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);

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