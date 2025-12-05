// routes/fundingSourceRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET /api/funding-sources?entity_id=...
router.get("/", async (req, res) => {
  const { entity_id } = req.query;

  try {
    let result;
    if (entity_id) {
      result = await pool.query(
        `SELECT id, name, code, description, entity_id, created_at
         FROM funding_sources
         WHERE entity_id = $1
         ORDER BY name ASC`,
        [entity_id]
      );
    } else {
      result = await pool.query(
        `SELECT id, name, code, description, entity_id, created_at
         FROM funding_sources
         ORDER BY name ASC`
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/funding-sources:", err);
    res.status(500).json({ message: "Gagal mengambil daftar sumber dana" });
  }
});

// POST /api/funding-sources
router.post("/", async (req, res) => {
  const { name, code, description, entity_id } = req.body;

  if (!name || !code || !entity_id) {
    return res.status(400).json({
      message: "Nama, kode, dan entitas sumber dana wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO funding_sources (name, code, description, entity_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, code, description, entity_id, created_at`,
      [name, code, description || null, entity_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/funding-sources error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Kode sumber dana sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal membuat sumber dana" });
  }
});

// PUT /api/funding-sources/:id
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description, entity_id } = req.body;

  if (!name || !code || !entity_id) {
    return res.status(400).json({
      message: "Nama, kode, dan entitas sumber dana wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE funding_sources
       SET name = $1,
           code = $2,
           description = $3,
           entity_id = $4
       WHERE id = $5
       RETURNING id, name, code, description, entity_id, created_at`,
      [name, code, description || null, entity_id, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sumber dana tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/funding-sources/:id:", err);
    res.status(500).json({ message: "Gagal mengubah sumber dana" });
  }
});

// DELETE /api/funding-sources/:id
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const used = await pool.query(
      "SELECT COUNT(*)::int AS c FROM assets WHERE funding_source_id = $1",
      [id]
    );

    if (used.rows[0].c > 0) {
      return res.status(400).json({
        message:
          "Tidak bisa menghapus sumber dana yang masih dipakai oleh aset",
      });
    }

    const result = await pool.query(
      "DELETE FROM funding_sources WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sumber dana tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error DELETE /api/funding-sources/:id:", err);
    res
      .status(500)
      .json({ message: "Gagal menghapus sumber dana" });
  }
});

export default router;
