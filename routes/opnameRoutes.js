// routes/opnameRoutes.js
import express from "express";
import pool from "../db.js";
import { verifyToken, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// 1. BUAT SESI BARU (Start Audit)
router.post("/", verifyToken, authorize("view_assets"), async (req, res) => {
  const { title, location_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // A. Buat Session Header
    const sessionRes = await client.query(
      `INSERT INTO opname_sessions (title, location_id, created_by, status) 
       VALUES ($1, $2, $3, 'On Progress') RETURNING id`,
      [title, location_id, req.user.id]
    );
    const sessionId = sessionRes.rows[0].id;

    // B. Ambil semua aset di lokasi tersebut (Snapshot)
    const assetsRes = await client.query(
      `SELECT id, condition FROM assets WHERE location_id = $1 AND deleted_at IS NULL`,
      [location_id]
    );

    // C. Masukkan ke tabel opname_items sebagai daftar "To-Do" (Default: Missing)
    if (assetsRes.rows.length > 0) {
      const values = assetsRes.rows.map(a => 
        `(${sessionId}, ${a.id}, 'Missing', '${a.condition}')`
      ).join(",");
      
      await client.query(
        `INSERT INTO opname_items (opname_session_id, asset_id, status, condition_actual) 
         VALUES ${values}`
      );
    }

    // D. Update total count
    await client.query(
      `UPDATE opname_sessions SET total_assets = $1 WHERE id = $2`,
      [assetsRes.rows.length, sessionId]
    );

    await client.query("COMMIT");
    res.json({ success: true, message: "Sesi Opname dimulai!", id: sessionId });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

// 2. GET LIST SESI
router.get("/", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, l.name as location_name, u.name as auditor_name 
       FROM opname_sessions s
       LEFT JOIN locations l ON l.id = s.location_id
       LEFT JOIN users u ON u.id = s.created_by
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. GET DETAIL ITEM AUDIT
router.get("/:id", verifyToken, async (req, res) => {
  try {
    // Header
    const sessionRes = await pool.query(
      `SELECT s.*, l.name as location_name FROM opname_sessions s
       JOIN locations l ON l.id = s.location_id
       WHERE s.id = $1`, [req.params.id]
    );
    
    // Items
    const itemsRes = await pool.query(
      `SELECT i.*, a.name as asset_name, a.code as asset_code, a.photo_url
       FROM opname_items i
       JOIN assets a ON a.id = i.asset_id
       WHERE i.opname_session_id = $1
       ORDER BY i.status DESC, a.name ASC`, [req.params.id]
    );

    if (sessionRes.rows.length === 0) return res.status(404).json({message: "Sesi tidak ditemukan"});

    res.json({ session: sessionRes.rows[0], items: itemsRes.rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. VERIFIKASI ITEM (SCAN ACTION)
router.put("/items/:itemId", verifyToken, async (req, res) => {
  const { status, condition, notes } = req.body; // status: 'Matched' / 'Missing'
  
  try {
    await pool.query(
      `UPDATE opname_items 
       SET status = $1, condition_actual = $2, notes = $3, scanned_at = NOW() 
       WHERE id = $4`,
      [status, condition, notes, req.params.itemId]
    );
    
    // Update progress count di header
    // (Logic sederhana: hitung ulang yg statusnya != Missing)
    const sessionIdRes = await pool.query(`SELECT opname_session_id FROM opname_items WHERE id = $1`, [req.params.itemId]);
    const sessionId = sessionIdRes.rows[0].opname_session_id;
    
    await pool.query(
        `UPDATE opname_sessions 
         SET scanned_assets = (SELECT COUNT(*) FROM opname_items WHERE opname_session_id = $1 AND status = 'Matched')
         WHERE id = $1`,
        [sessionId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. FINALIZE (Tutup Buku)
router.post("/:id/finalize", verifyToken, authorize("edit_assets"), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        
        // Update status sesi
        await client.query(
            `UPDATE opname_sessions SET status = 'Finalized', finalized_at = NOW(), verified_by = $1 WHERE id = $2`,
            [req.user.id, req.params.id]
        );

        // OPTIONAL: Update master data asset berdasarkan temuan?
        // Untuk keamanan, biasanya ERP High Class TIDAK otomatis update master, 
        // tapi memberi laporan selisih. Tapi kalau mau update otomatis (misal kondisi rusak), bisa tambah logic di sini.

        await client.query("COMMIT");
        res.json({ success: true, message: "Stock Opname Selesai & Dikunci." });
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json({ message: err.message });
    } finally {
        client.release();
    }
});

export default router;