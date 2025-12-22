// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import pool from "../db.js";

// 1. Verifikasi Token (Authentication)
export const verifyToken = (req, res, next) => {
  const token = req.cookies.token; // Ambil dari cookie

  if (!token) {
    return res.status(401).json({ message: "Akses ditolak, silakan login." });
  }

  try {
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // { id, email, roleSlugs, ... }
    next();
  } catch (err) {
    return res.status(403).json({ message: "Token tidak valid" });
  }
};

// 2. Cek Permission (Authorization - Spatie Style)
// Contoh penggunaan di route: authorize('create_user')
export const authorize = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;

      // Query sakti untuk cek permission user
      // User -> UserRoles -> Roles -> RolePermissions -> Permissions
      const result = await pool.query(
        `SELECT 1 
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE u.id = $1 AND p.slug = $2
         LIMIT 1`,
        [userId, requiredPermission]
      );

      // Kalau user Super Admin (slug: 'admin'), biasanya bypass semua permission
      // Cek apakah user punya role 'admin'
      const isAdmin = req.user.roleSlugs && req.user.roleSlugs.includes('admin');

      if (result.rowCount > 0 || isAdmin) {
        next(); // Lanjut, boleh akses
      } else {
        res.status(403).json({ message: `Anda tidak memiliki izin: ${requiredPermission}` });
      }
    } catch (err) {
      console.error("Authorization error:", err);
      res.status(500).json({ message: "Terjadi kesalahan otorisasi" });
    }
  };
};