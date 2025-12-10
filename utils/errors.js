export const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const ValidationError = (message) => createError(message, 400);
export const UnauthorizedError = (message) => createError(message, 401);
export const ForbiddenError = (message) => createError(message, 403);
export const NotFoundError = (message) => createError(message, 404);
export const ConflictError = (message) => createError(message, 409);