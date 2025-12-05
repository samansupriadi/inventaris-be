// routes/authRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email dan password wajib diisi" });
  }

  try {
    // ambil user dari DB
    const userRes = await pool.query(
      `SELECT id, name, email, password_hash, entity_id
       FROM users
       WHERE email = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [email]
    );

    if (userRes.rowCount === 0) {
      return res
        .status(400)
        .json({ message: "Email atau password salah" });
    }

    const row = userRes.rows[0];

    // cek password
    const match = await bcrypt.compare(password, row.password_hash || "");
    if (!match) {
      return res
        .status(400)
        .json({ message: "Email atau password salah" });
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
    // ambil semua permission dari role-role user
    const permsRes = await pool.query(
      `SELECT DISTINCT
         p.id,
         p.name,
         p.slug,
         p.group_name
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN roles r            ON r.id = rp.role_id
       JOIN user_roles ur      ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [row.id]
    );
    const permissions = permsRes.rows;

    // ===================== ENTITY ====================
    // entitas user (kalau ada)
    let entity = null;
    if (row.entity_id) {
      const entRes = await pool.query(
        `SELECT id, name, code
         FROM entities
         WHERE id = $1`,
        [row.entity_id]
      );
      if (entRes.rowCount > 0) {
        entity = entRes.rows[0];
      }
    }

    // ===================== RESPONSE ==================
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      entity,       // {id, name, code} atau null
      roles,        // array role
      permissions,  // ★ array permission
    };

    res.json({
      token: "dummy-token",
      user,
    });
  } catch (err) {
    console.error("POST /api/login error:", err);
    res.status(500).json({ message: "Gagal login" });
  }
});

export default router;
