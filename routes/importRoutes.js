// routes/importRoutes.js
import express from "express";
import multer from "multer";
import * as xlsx from "xlsx";
import pool from "../db.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() }); // Simpan di RAM sementara

// Helper: Bikin slug otomatis
const generateSlug = (text) => text.toString().toLowerCase().trim().replace(/[\s\W-]+/g, "_");

// Helper: Get or Create Master Data (Lokasi, Kategori, dll)
const getOrCreateId = async (client, tableName, nameValue, prefixCode = "GEN") => {
  if (!nameValue) return null;
  const name = nameValue.toString().trim();
  const slug = generateSlug(name);

  // 1. Cek exist
  const check = await client.query(`SELECT id FROM ${tableName} WHERE slug = $1`, [slug]);
  if (check.rows.length > 0) return check.rows[0].id;

  // 2. Create baru jika belum ada
  // Code otomatis: GEN-RANDOM (Bisa diubah logic-nya)
  const code = `${prefixCode}-${Math.floor(1000 + Math.random() * 9000)}`;
  
  // Perhatikan: Kolom tabel Bapak mungkin beda, sesuaikan (name, code, slug)
  const insert = await client.query(
    `INSERT INTO ${tableName} (name, slug, code) VALUES ($1, $2, $3) RETURNING id`,
    [name, slug, code]
  );
  return insert.rows[0].id;
};

// ENDPOINT IMPORT
router.post("/assets", verifyToken, authorize("import_data"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "File Excel wajib diupload." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Baca Buffer Excel
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (rawData.length === 0) throw new Error("File Excel kosong.");

    let successCount = 0;

    // 2. Loop setiap baris
    for (const row of rawData) {
      // Mapping nama kolom di Excel -> Variable
      // Pastikan User nanti pakai Template yang sesuai
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

      if (!namaAset) continue; // Skip jika nama kosong

      // 3. Smart Get or Create Dependencies
      // Tabel Bapak: asset_categories, locations, funding_sources
      const categoryId = await getOrCreateId(client, "asset_categories", kategoriName, "CAT");
      const locationId = await getOrCreateId(client, "locations", lokasiName, "LOC");
      const fundingId = await getOrCreateId(client, "funding_sources", sumberDanaName, "FND");

      // 4. Generate Kode Aset jika kosong di Excel
      const finalCode = kodeAset || `AST-${Date.now()}-${Math.floor(Math.random() * 100)}`;

      // 5. Insert Aset
      await client.query(
        `INSERT INTO assets 
         (name, code, category_id, location_id, funding_source_id, condition, value, purchase_date, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'available')
         ON CONFLICT (code) DO NOTHING`, // Skip jika kode aset duplikat
        [
          namaAset, 
          finalCode, 
          categoryId, 
          locationId, 
          fundingId, 
          kondisi || "baik", 
          nilai || 0, 
          tglBeli || new Date(), 
          notes
        ]
      );
      successCount++;
    }

    await client.query("COMMIT");
    res.json({ 
      success: true, 
      message: `Berhasil mengimport ${successCount} data aset. Master data (Lokasi/Kategori) otomatis dibuat.` 
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Import Error:", err);
    res.status(500).json({ message: "Gagal import: " + err.message });
  } finally {
    client.release();
  }
});

export default router;