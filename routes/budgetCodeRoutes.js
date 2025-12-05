// routes/budgetCodeRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET semua KMA, bisa difilter per sumber dana
// GET /api/budget-codes?funding_source_id=...
router.get("/", async (req, res) => {
  const { funding_source_id } = req.query;

  try {
    let result;
    if (funding_source_id) {
      result = await pool.query(
        `SELECT id, code, name, funding_source_id, created_at
         FROM budget_codes
         WHERE funding_source_id = $1
         ORDER BY code ASC`,
        [funding_source_id]
      );
    } else {
      result = await pool.query(
        `SELECT id, code, name, funding_source_id, created_at
         FROM budget_codes
         ORDER BY funding_source_id, code ASC`
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/budget-codes error:", err);
    res.status(500).json({ message: "Gagal mengambil kode mata anggaran" });
  }
});

// CREATE KMA
router.post("/", async (req, res) => {
  const { code, name, funding_source_id } = req.body;

  if (!code || !name || !funding_source_id) {
    return res.status(400).json({
      message: "Kode, nama anggaran, dan sumber dana wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO budget_codes (code, name, funding_source_id)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, funding_source_id, created_at`,
      [code, name, funding_source_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/budget-codes error:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        message: "Kode anggaran sudah digunakan di sumber dana ini",
      });
    }

    res
      .status(500)
      .json({ message: "Gagal membuat kode mata anggaran baru" });
  }
});

// UPDATE KMA
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { code, name, funding_source_id } = req.body;

  if (!code || !name || !funding_source_id) {
    return res.status(400).json({
      message: "Kode, nama anggaran, dan sumber dana wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE budget_codes
       SET code = $1,
           name = $2,
           funding_source_id = $3
       WHERE id = $4
       RETURNING id, code, name, funding_source_id, created_at`,
      [code, name, funding_source_id, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kode anggaran tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/budget-codes/:id error:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        message: "Kode anggaran sudah digunakan di sumber dana ini",
      });
    }

    res.status(500).json({ message: "Gagal mengubah kode mata anggaran" });
  }
});

// DELETE KMA
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      "DELETE FROM budget_codes WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kode anggaran tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budget-codes/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus kode mata anggaran" });
  }
});

export default router;
