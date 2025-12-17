import jwt from "jsonwebtoken";

// ACCESS TOKEN (Short-lived)
export const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "30m", // 30 minutes
  });
};

// REFRESH TOKEN (Long-lived)
export const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.REFRESH_SECRET, {
    expiresIn: "30d", // 30 days
  });
};

// VERIFY TOKEN (optional utility)
export const verifyToken = (token, secret = process.env.JWT_SECRET) => {
  return jwt.verify(token, secret);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.REFRESH_SECRET);
};
