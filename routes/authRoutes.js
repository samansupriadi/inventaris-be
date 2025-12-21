// routes/authRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken"; //
import pool from "../db.js";
import { loginLimiter } from "../middleware/limiter.js";

const router = express.Router();

// Terapkan 'loginLimiter' middleware di sini untuk mencegah brute force
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  // Security: Pesan error generik
  const invalidCredentialsMsg = "Email atau password salah";

  if (!email || !password) {
    return res.status(400).json({ message: "Email dan password wajib diisi" });
  }

  try {
    // 1. Ambil user dari DB
    const userRes = await pool.query(
      `SELECT id, name, email, password_hash, entity_id
       FROM users
       WHERE email = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [email]
    );

    if (userRes.rowCount === 0) {
      // Return 401 (Unauthorized) dengan pesan generik
      return res.status(401).json({ message: invalidCredentialsMsg });
    }

    const row = userRes.rows[0];

    // 2. Cek password
    const match = await bcrypt.compare(password, row.password_hash || "");
    if (!match) {
      return res.status(401).json({ message: invalidCredentialsMsg });
    }

    // ===================== ROLES =====================
    const rolesRes = await pool.query(
      `SELECT r.id, r.name, r.slug
       FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [row.id]
    );
    const roles = rolesRes.rows;

    // ================== PERMISSIONS ==================
    const permsRes = await pool.query(
      `SELECT DISTINCT
         p.id, p.name, p.slug, p.group_name
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN roles r            ON r.id = rp.role_id
       JOIN user_roles ur      ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [row.id]
    );
    const permissions = permsRes.rows;

    // ===================== ENTITY ====================
    let entity = null;
    if (row.entity_id) {
      const entRes = await pool.query(
        `SELECT id, name, code FROM entities WHERE id = $1`,
        [row.entity_id]
      );
      if (entRes.rowCount > 0) {
        entity = entRes.rows[0];
      }
    }

    // ===================== JWT & COOKIE (SUPER SECURE) ==================
    
    // Pastikan ada JWT_SECRET di .env Bapak
    const secret = process.env.JWT_SECRET || "rahasia_default_jangan_dipakai_di_prod";

    // Buat Token
    const token = jwt.sign(
      { 
        id: row.id, 
        email: row.email,
        roleSlugs: roles.map(r => r.slug) 
      },
      secret,
      { expiresIn: "1d" } // Token berlaku 1 hari
    );

    // Kirim Token lewat HttpOnly Cookie
    res.cookie("token", token, {
      httpOnly: true, // JS Frontend TIDAK BISA baca cookie ini (Anti XSS)
      secure: process.env.NODE_ENV === "production", // Wajib HTTPS di production
      sameSite: "strict", // Anti CSRF
      maxAge: 24 * 60 * 60 * 1000, // 1 hari dalam milidetik
    });

    // ===================== RESPONSE ==================
    // Kita TIDAK mengirim token di body JSON lagi agar tidak disimpan di localStorage
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      entity,
      roles,
      permissions,
    };

    res.json({
      message: "Login berhasil",
      user,
    });

  } catch (err) {
    console.error("POST /api/login error:", err);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
});

// Endpoint Logout (Wajib ada untuk hapus cookie)
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production"
  });
  res.json({ message: "Logout berhasil" });
});

export default router;