// middleware/limiter.js
import rateLimit from "express-rate-limit";

// Batasi 200 request per 15 menit per IP (Global)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200, 
  standardHeaders: true,
  legacyHeaders: false,
});

// Batasi 5 request per 15 menit (Khusus Login)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Terlalu banyak percobaan login. Akun dikunci sementara 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});