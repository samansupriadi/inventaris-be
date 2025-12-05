// routes/loanRoutes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../db.js";

const router = express.Router();

// ==== SETUP UPLOADS ====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

/* ============================================================
   GET ALL LOANS (include condition_before / after + photos)
============================================================ */
router.get("/", async (req, res) => {
  const { borrower, status } = req.query;

  try {
    let params = [];
    let where = "WHERE 1=1";

    if (borrower) {
      params.push(borrower);
      where += ` AND loans.borrower = $${params.length}`;
    }

    if (status) {
      params.push(status);
      where += ` AND loans.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT 
         loans.id,
         loans.asset_id,
         loans.borrower,
         loans.borrowed_at,
         loans.due_date,
         loans.returned_at,
         loans.status,
         loans.notes,

         -- NEW FIELDS
         loans.before_photo_url,
         loans.after_photo_url,
         loans.condition_before,
         loans.condition_after,

         -- asset info
         assets.name AS asset_name,
         assets.code AS asset_code
       FROM loans
       JOIN assets ON assets.id = loans.asset_id
       ${where}
       ORDER BY loans.borrowed_at DESC
       LIMIT 200`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/loans:", err);
    res.status(500).json({ message: "Gagal mengambil riwayat peminjaman" });
  }
});

/* ============================================================
   UPLOAD FOTO BEFORE PINJAM
============================================================ */
router.post(
  "/:id/before-photo",
  upload.single("before_photo"),
  async (req, res) => {
    const loanId = req.params.id;

    if (!req.file) {
      return res.status(400).json({
        message: "File foto BEFORE peminjaman tidak ditemukan",
      });
    }

    const relativePath = `/uploads/${req.file.filename}`;

    try {
      const result = await pool.query(
        `UPDATE loans
         SET before_photo_url = $1
         WHERE id = $2
         RETURNING *`,
        [relativePath, loanId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Loan tidak ditemukan" });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error("Error upload before-photo:", err);
      res.status(500).json({ message: "Gagal menyimpan foto BEFORE" });
    }
  }
);

/* ============================================================
   UPLOAD FOTO AFTER PENGEMBALIAN
============================================================ */
router.post(
  "/:id/after-photo",
  upload.single("after_photo"),
  async (req, res) => {
    const loanId = req.params.id;

    if (!req.file) {
      return res.status(400).json({
        message: "File foto AFTER pengembalian tidak ditemukan",
      });
    }

    const relativePath = `/uploads/${req.file.filename}`;

    try {
      const result = await pool.query(
        `UPDATE loans
         SET after_photo_url = $1
         WHERE id = $2
         RETURNING *`,
        [relativePath, loanId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ message: "Loan tidak ditemukan" });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error("Error upload after-photo:", err);
      res.status(500).json({ message: "Gagal menyimpan foto AFTER" });
    }
  }
);

/* ============================================================
   UPDATE KONDISI BEFORE / AFTER
============================================================ */
router.put("/:id/conditions", async (req, res) => {
  const loanId = req.params.id;
  const { condition_before, condition_after } = req.body;

  try {
    const result = await pool.query(
      `UPDATE loans
       SET condition_before = COALESCE($1, condition_before),
           condition_after  = COALESCE($2, condition_after)
       WHERE id = $3
       RETURNING *`,
      [condition_before, condition_after, loanId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Loan tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error update kondisi loan:", err);
    res.status(500).json({ message: "Gagal update kondisi pinjaman" });
  }
});

export default router;
