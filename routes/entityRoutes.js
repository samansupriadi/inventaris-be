import express from "express";
import pool from "../db.js";

const router = express.Router();

// LIST semua entitas
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, description, created_at
       FROM entities
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/entities error:", err);
    res.status(500).json({ message: "Gagal mengambil daftar entitas" });
  }
});

// CREATE entitas
router.post("/", async (req, res) => {
  const { name, code, description } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Nama entitas wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO entities (name, code, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/entities error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Kode entitas sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal membuat entitas" });
  }
});

// UPDATE entitas
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Nama entitas wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE entities
       SET name = $1,
           code = $2,
           description = $3
       WHERE id = $4
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Entitas tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/entities/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Kode entitas sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal mengubah entitas" });
  }
});

// DELETE entitas
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // cek apakah dipakai sumber dana atau user
    const fsUsed = await pool.query(
      "SELECT COUNT(*)::int AS c FROM funding_sources WHERE entity_id = $1",
      [id]
    );
    const userUsed = await pool.query(
      "SELECT COUNT(*)::int AS c FROM users WHERE entity_id = $1",
      [id]
    );

    if (fsUsed.rows[0].c > 0 || userUsed.rows[0].c > 0) {
      return res.status(400).json({
        message:
          "Tidak bisa menghapus entitas yang masih dipakai sumber dana / user",
      });
    }

    const result = await pool.query("DELETE FROM entities WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Entitas tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/entities/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus entitas" });
  }
});

export default router;
