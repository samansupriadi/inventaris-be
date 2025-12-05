// routes/permissionRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET /api/permissions  -> daftar permission
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, group_name, created_at, updated_at
       FROM permissions
       ORDER BY group_name NULLS LAST, name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/permissions error:", err);
    res.status(500).json({ message: "Gagal mengambil permissions" });
  }
});

// POST /api/permissions -> tambah permission baru
router.post("/", async (req, res) => {
  const { name, slug, group_name } = req.body;

  if (!name || !slug) {
    return res.status(400).json({
      message: "Nama dan slug permission wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO permissions (name, slug, group_name)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, group_name, created_at, updated_at`,
      [name, slug, group_name || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/permissions error:", err);

    if (err.code === "23505") {
      // unique (name/slug) bentrok
      return res
        .status(409)
        .json({ message: "Nama atau slug permission sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal membuat permission" });
  }
});

// PUT /api/permissions/:id -> update permission
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, slug, group_name } = req.body;

  if (!name || !slug) {
    return res.status(400).json({
      message: "Nama dan slug permission wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE permissions
       SET name = $1,
           slug = $2,
           group_name = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, slug, group_name, created_at, updated_at`,
      [name, slug, group_name || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Permission tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/permissions/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Nama atau slug permission sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal mengubah permission" });
  }
});

// DELETE /api/permissions/:id -> hapus permission
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // opsional: bisa cek dulu apakah sedang dipakai role_permissions
    const result = await pool.query(
      "DELETE FROM permissions WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Permission tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/permissions/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus permission" });
  }
});

export default router;
