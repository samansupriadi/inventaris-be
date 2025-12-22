// routes/importRoutes.js
import express from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import pool from "../db.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Slug Generator
const generateSlug = (text) => text.toString().toLowerCase().trim().replace(/[\s\W-]+/g, "_");

// Helper: Get or Create Master Data
const getOrCreateId = async (client, tableName, nameValue, prefixCode) => {
  if (!nameValue) return null;
  const name = nameValue.toString().trim();
  const slug = generateSlug(name);

  // Cek exist
  const check = await client.query(`SELECT id FROM ${tableName} WHERE slug = $1`, [slug]);
  if (check.rows.length > 0) return check.rows[0].id;

  // Create baru
  const code = `${prefixCode}-${Math.floor(1000 + Math.random() * 9000)}`;
  const insert = await client.query(
    `INSERT INTO ${tableName} (name, slug, code) VALUES ($1, $2, $3) RETURNING id`,
    [name, slug, code]
  );
  return insert.rows[0].id;
};

// ==========================================
// 1. IMPORT ASSETS (Dengan Batch ID)
// ==========================================
router.post("/assets", verifyToken, authorize("import_data"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "File Excel wajib diupload." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // A. Catat Sesi Import (Header)
    const historyRes = await client.query(
      `INSERT INTO import_histories (user_id, filename, total_rows) VALUES ($1, $2, 0) RETURNING id`,
      [req.user.id, req.file.originalname]
    );
    const historyId = historyRes.rows[0].id;

    // B. Baca Excel
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (rawData.length === 0) throw new Error("File Excel kosong.");

    let successCount = 0;

    // C. Loop Insert Data
    for (const row of rawData) {
      const {
        "Nama Aset": namaAset,
        "Kode Aset": kodeAset,
        "Kategori": kategoriName,
        "Lokasi": lokasiName,
        "Sumber Dana": sumberDanaName,
        "Kondisi": kondisi,
        "Nilai": nilai,
        "Tanggal Pembelian": tglBeli,
        "Keterangan": notes
      } = row;

      if (!namaAset) continue;

      // Dependencies
      const categoryId = await getOrCreateId(client, "asset_categories", kategoriName, "CAT");
      const locationId = await getOrCreateId(client, "locations", lokasiName, "LOC");
      const fundingId = await getOrCreateId(client, "funding_sources", sumberDanaName, "FND");

      const finalCode = kodeAset || `AST-${Date.now()}-${Math.floor(Math.random() * 100)}`;

      // Insert Aset dengan ID History
      await client.query(
        `INSERT INTO assets 
         (name, code, category_id, location_id, funding_source_id, condition, value, purchase_date, notes, status, import_history_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'available', $10)
         ON CONFLICT (code) DO NOTHING`,
        [
          namaAset, finalCode, categoryId, locationId, fundingId, 
          kondisi || "baik", nilai || 0, tglBeli || new Date(), notes, 
          historyId // <--- PENTING: Penanda Batch
        ]
      );
      successCount++;
    }

    // D. Update Summary
    await client.query(
      `UPDATE import_histories SET total_rows = $1, success_count = $2 WHERE id = $3`,
      [rawData.length, successCount, historyId]
    );

    await client.query("COMMIT");
    res.json({ success: true, message: `Berhasil mengimport ${successCount} data aset.` });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Import Error:", err);
    res.status(500).json({ message: "Gagal import: " + err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 2. LIST HISTORY (Riwayat Import)
// ==========================================
router.get("/history", verifyToken, authorize("import_data"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, u.name as user_name 
       FROM import_histories h
       LEFT JOIN users u ON u.id = h.user_id
       ORDER BY h.created_at DESC LIMIT 10` // Tampilkan 10 terakhir
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil riwayat import" });
  }
});

// ==========================================
// 3. ROLLBACK (Batalkan Import)
// ==========================================
router.delete("/history/:id", verifyToken, authorize("import_data"), async (req, res) => {
  const id = req.params.id;
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // 1. Hapus semua aset yang punya import_history_id ini
    const deleteAssets = await client.query(
      `DELETE FROM assets WHERE import_history_id = $1`, 
      [id]
    );

    // 2. Hapus log history-nya
    await client.query(`DELETE FROM import_histories WHERE id = $1`, [id]);

    await client.query("COMMIT");
    res.json({ 
      success: true, 
      message: `Rollback berhasil! ${deleteAssets.rowCount} aset telah dihapus.` 
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rollback Error:", err);
    res.status(500).json({ message: "Gagal melakukan rollback" });
  } finally {
    client.release();
  }
});

export default router;