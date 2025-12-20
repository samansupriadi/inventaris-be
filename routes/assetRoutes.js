// routes/assetRoutes.js
import express from "express";
import pool from "../db.js";
import { upload } from "../upload.js";

const router = express.Router();

// GET /api/assets?entity_id=...&include_deleted=true
router.get("/", async (req, res) => {
  const { entity_id, include_deleted } = req.query;

  try {
    let query = `
      SELECT a.id, a.name, a.code, a.location, a.condition, a.status,
             a.funding_source_id, a.value, a.location_id, a.category_id,
             a.budget_code_id, a.notes, a.purchase_date, a.sequence_no,
             a.photo_url, a.receipt_url, a.created_at, a.deleted_at
      FROM assets a
    `;

    const params = [];
    const where = [];

    // default: hanya yg aktif
    if (include_deleted !== "true") {
      where.push(`a.deleted_at IS NULL`);
    }

    if (entity_id) {
      query += ` JOIN funding_sources fs ON fs.id = a.funding_source_id `;
      params.push(entity_id);
      where.push(`fs.entity_id = $${params.length}`);
    }

    if (where.length) query += ` WHERE ${where.join(" AND ")} `;
    query += ` ORDER BY a.created_at DESC`;

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

/* ============================================================
   BORROW ASSET (PINJAM) - FIX DETAIL LOKASI & NOTES
============================================================ */
router.post("/:id/borrow", async (req, res) => {
  const assetId = req.params.id;
  // Ambil data baru dari body (detail_location & notes)
  const { 
    borrower_user_id, 
    usage_location_id, 
    due_date, 
    condition_now, 
    detail_location, // <--- Data baru dari Frontend
    notes            // <--- Data baru dari Frontend
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Ambil nama peminjam (untuk kolom text 'borrower' di tabel loans)
    const userRes = await client.query("SELECT name FROM users WHERE id = $1", [
      borrower_user_id,
    ]);
    if (userRes.rowCount === 0) {
      throw new Error("User peminjam tidak ditemukan");
    }
    const borrowerName = userRes.rows[0].name;

    // 2. Insert ke tabel LOANS
    // Tambahkan kolom 'notes' ke dalam query insert
    const loanRes = await client.query(
      `INSERT INTO loans (
         asset_id, 
         borrower_user_id, 
         borrower, 
         usage_location_id, 
         due_date, 
         condition_before, 
         status, 
         notes,           -- <--- Simpan catatan di sini
         borrowed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'borrowed', $7, NOW())
       RETURNING id`,
      [
        assetId,
        borrower_user_id,
        borrowerName,
        usage_location_id,
        due_date,
        condition_now || "baik",
        notes || ""       // <--- Masukkan nilai notes
      ]
    );
    
    const newLoanId = loanRes.rows[0].id;

    // 3. Update tabel ASSETS
    // Update location_id (Utama) DAN location (Detail)
    const updateAssetRes = await client.query(
      `UPDATE assets
       SET status = 'borrowed',
           location_id = $1,      -- Update Lokasi Utama (ID)
           location = $2,         -- Update Detail Lokasi (Text) <--- INI YG DITAMBAH
           condition = $3         -- Update Kondisi Terkini
       WHERE id = $4
       RETURNING *`,
      [
        usage_location_id, 
        detail_location || "", // Masukkan detail lokasi baru
        condition_now || "baik", 
        assetId
      ]
    );

    await client.query("COMMIT");

    // 4. Kirim response data terbaru agar Frontend langsung berubah
    res.json({
      message: "Peminjaman berhasil dicatat",
      loan: { id: newLoanId },
      asset: updateAssetRes.rows[0], // Aset dengan lokasi baru
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error borrow asset:", err);
    res.status(500).json({ message: err.message || "Gagal memproses peminjaman" });
  } finally {
    client.release();
  }
});




// POST /api/assets/:id/return
router.post("/:id/return", async (req, res) => {
  const assetId = req.params.id;
  const { condition_after, update_asset_location } = req.body || {};

  try {
    const loanResult = await pool.query(
      `SELECT *
       FROM loans
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

    // update loans: returned + condition_after
    const updatedLoanRes = await pool.query(
      `UPDATE loans
       SET status = 'returned',
           returned_at = NOW(),
           condition_after = COALESCE($1, condition_after)
       WHERE id = $2
       RETURNING
         id, asset_id, borrower, borrower_user_id, usage_location_id,
         borrowed_at, due_date, returned_at, status, notes,
         before_photo_url, after_photo_url, condition_before, condition_after`,
      [condition_after || null, loan.id]
    );

    const updatedLoan = updatedLoanRes.rows[0];

    // update assets: available + optional location update
    const newLocationId =
      update_asset_location ? loan.usage_location_id : null;

    const updatedAssetResult = await pool.query(
      `UPDATE assets
       SET status = 'available',
           location_id = COALESCE($2, location_id)
       WHERE id = $1
       RETURNING
         id, name, code, location, location_id,
         condition, status, photo_url, created_at,
         funding_source_id, value, purchase_date, receipt_url, category_id`,
      [assetId, newLocationId]
    );

    res.json({
      asset: updatedAssetResult.rows[0],
      loan: updatedLoan,
    });
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

// PUT /api/assets/:id  (EDIT aset)
router.put("/:id", async (req, res) => {
  const id = req.params.id;
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
    status,
  } = req.body;

  if (!name) return res.status(400).json({ message: "Nama aset wajib diisi" });

  try {
    const result = await pool.query(
      `UPDATE assets
       SET name = $1,
           location = $2,
           condition = $3,
           status = COALESCE($4, status),
           funding_source_id = $5,
           value = $6,
           location_id = $7,
           category_id = $8,
           budget_code_id = $9,
           notes = $10,
           purchase_date = $11
       WHERE id = $12 AND deleted_at IS NULL
       RETURNING
         id, name, code, location, condition, status,
         funding_source_id, value, location_id, category_id, budget_code_id,
         notes, purchase_date, sequence_no, photo_url, receipt_url, created_at`,
      [
        name,
        location || null,
        condition || null,
        status || null,
        funding_source_id || null,
        value || null,
        location_id || null,
        category_id || null,
        budget_code_id || null,
        notes || null,
        purchase_date || null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/assets/:id error:", err);
    res.status(500).json({ message: "Gagal mengubah aset" });
  }
});

// DELETE /api/assets/:id  (SOFT DELETE)
router.delete("/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      `UPDATE assets
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan / sudah terhapus" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/assets/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus aset" });
  }
});

// POST /api/assets/:id/restore
router.post("/:id/restore", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await pool.query(
      `UPDATE assets
       SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Aset tidak ditemukan / belum terhapus" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/assets/:id/restore error:", err);
    res.status(500).json({ message: "Gagal restore aset" });
  }
});



export default router;
