// routes/categoryRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// LIST semua kategori
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, description, created_at
       FROM asset_categories
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/categories:", err);
    res.status(500).json({ message: "Gagal mengambil daftar kategori" });
  }
});

// CREATE kategori
router.post("/", async (req, res) => {
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama kategori wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO asset_categories (name, code, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/categories:", err);

    // constraint UNIQUE (nama/kode)
    if (err.code === "23505") {
      return res.status(409).json({
        message: "Nama atau kode kategori sudah digunakan",
      });
    }

    res.status(500).json({ message: "Gagal membuat kategori baru" });
  }
});

// UPDATE kategori
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama kategori wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE asset_categories
       SET name = $1,
           code = $2,
           description = $3
       WHERE id = $4
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kategori tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/categories/:id:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        message: "Nama atau kode kategori sudah digunakan",
      });
    }

    res.status(500).json({ message: "Gagal mengubah kategori" });
  }
});

// DELETE kategori
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // cek dipakai aset atau tidak
    const used = await pool.query(
      "SELECT COUNT(*)::int AS c FROM assets WHERE category_id = $1",
      [id]
    );

    if (used.rows[0].c > 0) {
      return res.status(400).json({
        message: "Tidak bisa menghapus kategori yang masih dipakai oleh aset",
      });
    }

    const result = await pool.query(
      "DELETE FROM asset_categories WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kategori tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error DELETE /api/categories/:id:", err);
    res.status(500).json({ message: "Gagal menghapus kategori" });
  }
});

export default router;
