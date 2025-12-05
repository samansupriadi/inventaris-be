// routes/assetRoutes.js
import express from "express";
import pool from "../db.js";
import { upload } from "../upload.js";

const router = express.Router();

// GET /api/assets?entity_id=...
router.get("/", async (req, res) => {
  const { entity_id } = req.query;

  try {
    let query = `
      SELECT
        a.id,
        a.name,
        a.code,
        a.location,
        a.condition,
        a.status,
        a.funding_source_id,
        a.value,
        a.location_id,
        a.category_id,
        a.budget_code_id,
        a.notes,
        a.purchase_date,
        a.sequence_no,
        a.photo_url,
        a.receipt_url,
        a.created_at
      FROM assets a
    `;
    const params = [];

    if (entity_id) {
      params.push(entity_id);
      query += `
        JOIN funding_sources fs ON fs.id = a.funding_source_id
        WHERE fs.entity_id = $1
      `;
    }

    query += " ORDER BY a.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/assets:", err);
    res.status(500).json({ message: "Failed to fetch assets" });
  }
});

// POST /api/assets
router.post("/", async (req, res) => {
  const {
    name,
    location,
    condition,
    funding_source_id,
    value,
    location_id,
    category_id,
    budget_code_id,
    notes,
    purchase_date,
  } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Nama aset wajib diisi" });
  }
  if (!funding_source_id) {
    return res
      .status(400)
      .json({ message: "Sumber dana wajib dipilih untuk penomoran aset" });
  }
  if (!category_id) {
    return res
      .status(400)
      .json({ message: "Kategori aset wajib dipilih untuk penomoran aset" });
  }

  const purchaseDateStr =
    purchase_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const fsRes = await client.query(
      `SELECT id, code FROM funding_sources WHERE id = $1`,
      [funding_source_id]
    );
    if (fsRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Sumber dana tidak valid" });
    }
    const fsCode = fsRes.rows[0].code;

    const catRes = await client.query(
      `SELECT id, code FROM asset_categories WHERE id = $1`,
      [category_id]
    );
    if (catRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Kategori aset tidak valid" });
    }
    const catCode = catRes.rows[0].code;

    const seqRes = await client.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
       FROM assets
       WHERE funding_source_id = $1
         AND category_id = $2`,
      [funding_source_id, category_id]
    );
    const seq = seqRes.rows[0].next_seq || 1;
    const seqStr = String(seq).padStart(4, "0");

    const d = new Date(purchaseDateStr);
    const monthStr = String(d.getMonth() + 1).padStart(2, "0");
    const yearStr = String(d.getFullYear());

    const generatedCode = `${seqStr}/${fsCode}-${catCode}/${monthStr}-${yearStr}`;

    const insertRes = await client.query(
      `INSERT INTO assets
        (name, code, location, condition, status,
         funding_source_id, value, location_id,
         category_id, budget_code_id, notes,
         purchase_date, sequence_no)
       VALUES
        ($1, $2, $3, $4, 'available',
         $5, $6, $7,
         $8, $9, $10,
         $11, $12)
       RETURNING
         id, name, code, location, condition, status,
         funding_source_id, value, location_id,
         category_id, budget_code_id, notes,
         purchase_date, sequence_no,
         photo_url, receipt_url, created_at`,
      [
        name,
        generatedCode,
        location || null,
        condition || null,
        funding_source_id,
        value || null,
        location_id || null,
        category_id,
        budget_code_id || null,
        notes || null,
        purchaseDateStr,
        seq,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/assets error:", err);
    res.status(500).json({ message: "Gagal membuat aset" });
  } finally {
    client.release();
  }
});

// POST /api/assets/:id/borrow
// PINJAM aset
router.post("/:id/borrow", async (req, res) => {
  const assetId = req.params.id;
  const { borrower, due_date, notes } = req.body;   // ← tambah notes

  if (!borrower) {
    return res.status(400).json({ message: "Nama peminjam wajib diisi" });
  }

  try {
    // cek aset dulu
    const assetResult = await pool.query(
      "SELECT * FROM assets WHERE id = $1",
      [assetId]
    );
    if (assetResult.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan" });
    }
    const asset = assetResult.rows[0];

    if (asset.status === "borrowed") {
      return res
        .status(400)
        .json({ message: "Aset ini sedang dipinjam" });
    }

    // insert ke loans (sekarang dengan notes)
    const loanRes = await pool.query(
      `INSERT INTO loans (asset_id, borrower, due_date, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, asset_id, borrower, borrowed_at, due_date, returned_at, status, notes, before_photo_url`,
      [assetId, borrower, due_date || null, notes || null]
    );
    const loan = loanRes.rows[0];

    // update status aset
    const updatedAssetResult = await pool.query(
      `UPDATE assets
       SET status = 'borrowed'
       WHERE id = $1
       RETURNING
            id, name, code, location, location_id,
            condition, status, photo_url, created_at,
            funding_source_id, value, purchase_date, receipt_url, category_id`,
      [assetId]
    );

    // bisa kirim sekaligus loan + aset kalau mau
    res.json({
      asset: updatedAssetResult.rows[0],
      loan,
    });
  } catch (err) {
    console.error("Error POST /api/assets/:id/borrow:", err);
    res.status(500).json({ message: "Gagal memproses peminjaman" });
  }
});


// POST /api/assets/:id/return
router.post("/:id/return", async (req, res) => {
  const assetId = req.params.id;

  try {
    const loanResult = await pool.query(
      `SELECT * FROM loans
       WHERE asset_id = $1 AND status = 'borrowed'
       ORDER BY borrowed_at DESC
       LIMIT 1`,
      [assetId]
    );

    if (loanResult.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Tidak ada peminjaman aktif untuk aset ini" });
    }

    const loan = loanResult.rows[0];

    await pool.query(
      `UPDATE loans
       SET status = 'returned',
           returned_at = NOW()
       WHERE id = $1`,
      [loan.id]
    );

    const updatedAssetResult = await pool.query(
      `UPDATE assets
       SET status = 'available'
       WHERE id = $1
       RETURNING
            id, name, code, location, location_id,
            condition, status, photo_url, created_at,
            funding_source_id, value, purchase_date, receipt_url, category_id`,
      [assetId]
    );

    res.json(updatedAssetResult.rows[0]);
  } catch (err) {
    console.error("Error POST /api/assets/:id/return:", err);
    res.status(500).json({ message: "Gagal memproses pengembalian" });
  }
});

// POST /api/assets/:id/photo
router.post("/:id/photo", upload.single("photo"), async (req, res) => {
  const assetId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ message: "File foto tidak ditemukan" });
  }

  const relativePath = `/uploads/${req.file.filename}`;

  try {
    const result = await pool.query(
      `UPDATE assets
       SET photo_url = $1
       WHERE id = $2
       RETURNING
            id, name, code, location, location_id,
            condition, status, photo_url, created_at,
            funding_source_id, value, purchase_date, receipt_url, category_id`,
      [relativePath, assetId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error upload foto aset:", err);
    res.status(500).json({ message: "Gagal menyimpan foto aset" });
  }
});

// POST /api/assets/:id/receipt
router.post("/:id/receipt", upload.single("receipt"), async (req, res) => {
  const assetId = req.params.id;

  if (!req.file) {
    return res.status(400).json({ message: "File kwitansi tidak ditemukan" });
  }

  const relativePath = `/uploads/${req.file.filename}`;

  try {
    const result = await pool.query(
      `UPDATE assets
       SET receipt_url = $1
       WHERE id = $2
       RETURNING
            id, name, code, location, location_id,
            condition, status, photo_url, created_at,
            funding_source_id, value, purchase_date, receipt_url, category_id`,
      [relativePath, assetId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error upload kwitansi aset:", err);
    res.status(500).json({ message: "Gagal menyimpan kwitansi aset" });
  }
});

export default router;
