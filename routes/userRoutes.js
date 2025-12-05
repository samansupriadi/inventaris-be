// routes/userRoutes.js
import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();

// LIST users (aktif, tidak terhapus)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         u.id,
         u.name,
         u.email,
         u.entity_id,
         e.name AS entity_name,
         u.created_at,
         u.updated_at,
         u.deleted_at,
         COALESCE(
           json_agg(
             json_build_object('id', r.id, 'name', r.name, 'slug', r.slug)
           ) FILTER (WHERE r.id IS NOT NULL),
           '[]'
         ) AS roles
       FROM users u
       LEFT JOIN entities e ON e.id = u.entity_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.id, e.name
       ORDER BY u.created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ message: "Gagal mengambil data user" });
  }
});

// CREATE user
router.post("/", async (req, res) => {
  const { name, email, password, role_ids, entity_id } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Nama, email, dan password wajib diisi" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // (potongan penting)
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, entity_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, entity_id, created_at, updated_at, deleted_at`,
      [name, email, passwordHash, entity_id || null]
    );

    const user = userRes.rows[0];

    // simpan role (kalau ada)
    if (Array.isArray(role_ids) && role_ids.length > 0) {
      const values = role_ids.map((rid, idx) => `($1, $${idx + 2})`).join(",");
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [user.id, ...role_ids]
      );
    }

    res.status(201).json(user);
  } catch (err) {
    console.error("POST /api/users error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Email sudah digunakan user lain" });
    }

    res.status(500).json({ message: "Gagal membuat user" });
  }
});

// UPDATE user
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, email, password, role_ids, entity_id } = req.body;

  if (!name || !email) {
    return res
      .status(400)
      .json({ message: "Nama dan email wajib diisi" });
  }

  try {
    let passwordPart = "";
    const params = [name, email, entity_id || null, id]; // $1, $2, $3, $4

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      passwordPart = ", password_hash = $5";
      params.push(passwordHash);
    }

    const updateQuery = `
      UPDATE users
      SET name = $1,
          email = $2,
          entity_id = $3,
          updated_at = NOW()
          ${passwordPart}
      WHERE id = $4
      AND deleted_at IS NULL
      RETURNING id, name, email, entity_id, created_at, updated_at, deleted_at
    `;

    const result = await pool.query(updateQuery, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const user = result.rows[0];

    // update roles: hapus dulu lalu insert ulang
    if (Array.isArray(role_ids)) {
      await pool.query("DELETE FROM user_roles WHERE user_id = $1", [id]);

      if (role_ids.length > 0) {
        const values = role_ids
          .map((rid, idx) => `($1, $${idx + 2})`)
          .join(",");
        await pool.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ${values}`,
          [id, ...role_ids]
        );
      }
    }

    res.json(user);
  } catch (err) {
    console.error("PUT /api/users/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Email sudah digunakan user lain" });
    }

    res.status(500).json({ message: "Gagal mengubah user" });
  }
});

// SOFT DELETE user
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "User tidak ditemukan atau sudah dihapus" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus user" });
  }
});

// RESTORE user
router.post("/:id/restore", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id, name, email, created_at, updated_at, deleted_at`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "User tidak ditemukan atau belum dihapus" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/users/:id/restore error:", err);
    res.status(500).json({ message: "Gagal me-restore user" });
  }
});

export default router;
