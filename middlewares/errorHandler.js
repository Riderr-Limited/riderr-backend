/**
 * Global error handler middleware
 */
export const errorHandler = (err, req, res, next) => {
  // Log error for debugging
  console.error('🔥 ERROR:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Default error response
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Handle specific error types
  let response = {
    success: false,
    message,
    error: err.name || 'ServerError'
  };

  // Development: include stack trace
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    response.message = 'Validation Error';
    response.errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message
    }));
    return res.status(400).json(response);
  }

  // Handle duplicate key errors (MongoDB)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    response.message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    return res.status(409).json(response);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    response.message = 'Invalid token';
    return res.status(401).json(response);
  }

  if (err.name === 'TokenExpiredError') {
    response.message = 'Token expired';
    return res.status(401).json(response);
  }

  // Handle CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    response.message = `Invalid ${err.path}: ${err.value}`;
    return res.status(400).json(response);
  }

  // Handle rate limit errors
  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      error: 'RateLimitExceeded'
    });
  }

  // Send response
  res.status(statusCode).json(response);
};