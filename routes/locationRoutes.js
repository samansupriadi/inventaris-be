// routes/locationRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// LIST semua lokasi
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, description, created_at
       FROM locations
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/locations:", err);
    res.status(500).json({ message: "Gagal mengambil daftar lokasi" });
  }
});

// CREATE lokasi
router.post("/", async (req, res) => {
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama lokasi wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO locations (name, code, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/locations:", err);
    res.status(500).json({ message: "Gagal membuat lokasi baru" });
  }
});

// UPDATE lokasi
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama lokasi wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE locations
       SET name = $1,
           code = $2,
           description = $3
       WHERE id = $4
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Lokasi tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/locations/:id:", err);
    res.status(500).json({ message: "Gagal mengubah lokasi" });
  }
});

// DELETE lokasi
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // cek apakah dipakai aset
    const used = await pool.query(
      "SELECT COUNT(*)::int AS c FROM assets WHERE location_id = $1",
      [id]
    );

    if (used.rows[0].c > 0) {
      return res.status(400).json({
        message: "Tidak bisa menghapus lokasi yang masih dipakai oleh aset",
      });
    }

    const result = await pool.query(
      "DELETE FROM locations WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Lokasi tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error DELETE /api/locations/:id:", err);
    res.status(500).json({ message: "Gagal menghapus lokasi" });
  }
});

export default router;
