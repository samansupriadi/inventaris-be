import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt"; 

dotenv.config();
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 4000;

// ====== KONFIG DATABASE ======
const pool = new Pool({
  host: process.env.DB_HOST,      // contoh: "localhost"
  port: process.env.DB_PORT,      // contoh: 5432
  database: process.env.DB_NAME,  // contoh: "inventaris"
  user: process.env.DB_USER,      // contoh: "inventaris"
  password: process.env.DB_PASSWORD,
});

app.use(cors());
app.use(express.json());

// ====== SETUP UPLOADS ======
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});
const upload = multer({ storage });

// ====== HEALTH CHECK ======
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", time: result.rows[0].now });
  } catch (err) {
    console.error("Error /api/health:", err);
    res.status(500).json({ status: "error" });
  }
});

// ====== ASSETS: GET & CREATE ======

// GET semua aset
app.get("/api/assets", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        name,
        code,
        location,
        condition,
        status,
        funding_source_id,
        value,
        location_id,
        category_id,
        budget_code_id,
        notes,
        purchase_date,
        sequence_no,
        photo_url,
        receipt_url,
        created_at
      FROM assets
      ORDER BY created_at DESC;
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/assets:", err);
    res.status(500).json({ message: "Failed to fetch assets" });
  }
});



// POST tambah aset baru
app.post("/api/assets", async (req, res) => {
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
    purchase_date,  // "2025-10-15" misalnya
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

  // kalau user lupa isi tanggal beli, kita pakai hari ini
  const purchaseDateStr = purchase_date || new Date().toISOString().slice(0, 10);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ambil kode sumber dana (mis: "W")
    const fsRes = await client.query(
      `SELECT id, code FROM funding_sources WHERE id = $1`,
      [funding_source_id]
    );
    if (fsRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Sumber dana tidak valid" });
    }
    const fsCode = fsRes.rows[0].code; // mis: "W"

    // ambil kode kategori (mis: "IK", "IKE")
    const catRes = await client.query(
      `SELECT id, code FROM asset_categories WHERE id = $1`,
      [category_id]
    );
    if (catRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Kategori aset tidak valid" });
    }
    const catCode = catRes.rows[0].code; // mis: "IK"

    // hitung sequence_no berikutnya untuk kombinasi (sumber dana, kategori)
    const seqRes = await client.query(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
       FROM assets
       WHERE funding_source_id = $1
         AND category_id = $2`,
      [funding_source_id, category_id]
    );
    const seq = seqRes.rows[0].next_seq || 1;
    const seqStr = String(seq).padStart(4, "0"); // 1 -> "0001"

    // format bulan-tahun dari purchase_date
    const d = new Date(purchaseDateStr);
    const monthStr = String(d.getMonth() + 1).padStart(2, "0"); // 0-based
    const yearStr = String(d.getFullYear());

    const generatedCode = `${seqStr}/${fsCode}-${catCode}/${monthStr}-${yearStr}`;
    // contoh: "0001/W-IK/12-2021"

    // insert aset
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




// ====== PEMINJAMAN / PENGEMBALIAN ASET ======

// PINJAM aset
app.post("/api/assets/:id/borrow", async (req, res) => {
  const assetId = req.params.id;
  const { borrower, due_date } = req.body;

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

    // insert ke loans
    await pool.query(
      `INSERT INTO loans (asset_id, borrower, due_date)
       VALUES ($1, $2, $3)`,
      [assetId, borrower, due_date || null]
    );

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

    res.json(updatedAssetResult.rows[0]);
  } catch (err) {
    console.error("Error POST /api/assets/:id/borrow:", err);
    res.status(500).json({ message: "Gagal memproses peminjaman" });
  }
});

// KEMBALIKAN aset
app.post("/api/assets/:id/return", async (req, res) => {
  const assetId = req.params.id;

  try {
    // cari loan yang masih "borrowed"
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

    // update loan jadi returned
    await pool.query(
      `UPDATE loans
       SET status = 'returned',
           returned_at = NOW()
       WHERE id = $1`,
      [loan.id]
    );

    // update aset jadi available
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

// ====== RIWAYAT PEMINJAMAN (LOANS) ======
app.get("/api/loans", async (req, res) => {
  try {
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
         assets.name AS asset_name,
         assets.code AS asset_code
       FROM loans
       JOIN assets ON assets.id = loans.asset_id
       ORDER BY loans.borrowed_at DESC
       LIMIT 200`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/loans:", err);
    res
      .status(500)
      .json({ message: "Gagal mengambil riwayat peminjaman" });
  }
});

// ====== UPLOAD FOTO ASET ======
app.post("/api/assets/:id/photo", upload.single("photo"), async (req, res) => {
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


// ====== UPLOAD KWITANSI PEMBELIAN ASET ======
app.post(
  "/api/assets/:id/receipt",
  upload.single("receipt"),
  async (req, res) => {
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
  }
);



// ====== CRUD SUMBER DANA (FUNDING SOURCES) ======

// LIST semua sumber dana
app.get("/api/funding-sources", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, description, created_at
       FROM funding_sources
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/funding-sources:", err);
    res
      .status(500)
      .json({ message: "Gagal mengambil daftar sumber dana" });
  }
});

// CREATE sumber dana
app.post("/api/funding-sources", async (req, res) => {
  const { name, code, description } = req.body;

  if (!name || !code) {
    return res
      .status(400)
      .json({ message: "Nama dan kode sumber dana wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO funding_sources (name, code, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, description, created_at`,
      [name, code, description || null]
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

// UPDATE sumber dana
app.put("/api/funding-sources/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description } = req.body;

  if (!name || !code) {
    return res
      .status(400)
      .json({ message: "Nama dan kode sumber dana wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE funding_sources
       SET name = $1,
           code = $2,
           description = $3
       WHERE id = $4
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sumber dana tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/funding-sources/:id:", err);
    res
      .status(500)
      .json({ message: "Gagal mengubah sumber dana" });
  }
});

// DELETE sumber dana
app.delete("/api/funding-sources/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // cek apakah masih dipakai aset
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



// ====== CRUD LOKASI (LOCATIONS) ======

// LIST semua lokasi
app.get("/api/locations", async (req, res) => {
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
app.post("/api/locations", async (req, res) => {
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
app.put("/api/locations/:id", async (req, res) => {
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
app.delete("/api/locations/:id", async (req, res) => {
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



// ====== CRUD KATEGORI ASET (asset_categories) ======

// LIST semua kategori
app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, code, description, created_at
       FROM asset_categories
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error GET /api/categories:", err);
    res.status(500).json({ message: "Gagal mengambil daftar kategori" });
  }
});

// CREATE kategori
app.post("/api/categories", async (req, res) => {
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama kategori wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO asset_categories (name, code, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error POST /api/categories:", err);

    // kalau nama/kode sudah ada (constraint UNIQUE)
    if (err.code === "23505") {
      return res.status(409).json({
        message: "Nama atau kode kategori sudah digunakan",
      });
    }

    res.status(500).json({ message: "Gagal membuat kategori baru" });
  }
});


// UPDATE kategori
app.put("/api/categories/:id", async (req, res) => {
  const id = req.params.id;
  const { name, code, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ message: "Nama kategori wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE asset_categories
       SET name = $1,
           code = $2,
           description = $3
       WHERE id = $4
       RETURNING id, name, code, description, created_at`,
      [name, code || null, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kategori tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error PUT /api/categories/:id:", err);

    if (err.code === "23505") {
      return res.status(409).json({
        message: "Nama atau kode kategori sudah digunakan",
      });
    }

    res.status(500).json({ message: "Gagal mengubah kategori" });
  }
});


// DELETE kategori
app.delete("/api/categories/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // cek dipakai aset atau tidak
    const used = await pool.query(
      "SELECT COUNT(*)::int AS c FROM assets WHERE category_id = $1",
      [id]
    );

    if (used.rows[0].c > 0) {
      return res.status(400).json({
        message: "Tidak bisa menghapus kategori yang masih dipakai oleh aset",
      });
    }

    const result = await pool.query(
      "DELETE FROM asset_categories WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Kategori tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error DELETE /api/categories/:id:", err);
    res.status(500).json({ message: "Gagal menghapus kategori" });
  }
});



// ====== ROLES (HAK AKSES LEVEL TINGGI) ======
app.get("/api/roles", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, description, created_at, updated_at
       FROM roles
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/roles error:", err);
    res.status(500).json({ message: "Gagal mengambil data role" });
  }
});

app.post("/api/roles", async (req, res) => {
  const { name, slug, description } = req.body;

  if (!name || !slug) {
    return res
      .status(400)
      .json({ message: "Nama dan slug role wajib diisi" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO roles (name, slug, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, description, created_at, updated_at`,
      [name, slug, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/roles error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Nama atau slug role sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal membuat role" });
  }
});


app.put("/api/roles/:id", async (req, res) => {
  const id = req.params.id;
  const { name, slug, description } = req.body;

  if (!name || !slug) {
    return res
      .status(400)
      .json({ message: "Nama dan slug role wajib diisi" });
  }

  try {
    const result = await pool.query(
      `UPDATE roles
       SET name = $1,
           slug = $2,
           description = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, slug, description, created_at, updated_at`,
      [name, slug, description || null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Role tidak ditemukan" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /api/roles/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Nama atau slug role sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal mengubah role" });
  }
});

app.delete("/api/roles/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // opsional: cek apakah masih dipakai user
    const used = await pool.query(
      "SELECT COUNT(*)::int AS c FROM user_roles WHERE role_id = $1",
      [id]
    );
    if (used.rows[0].c > 0) {
      return res.status(400).json({
        message: "Tidak bisa menghapus role yang masih dipakai user",
      });
    }

    const result = await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Role tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/roles/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus role" });
  }
});

// ====== USERS ======
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         u.id,
         u.name,
         u.email,
         u.created_at,
         u.updated_at,
         u.deleted_at,
         COALESCE(
           json_agg(
             json_build_object('id', r.id, 'name', r.name, 'slug', r.slug)
           ) FILTER (WHERE r.id IS NOT NULL),
           '[]'
         ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ message: "Gagal mengambil data user" });
  }
});

app.post("/api/users", async (req, res) => {
  const { name, email, password, role_ids } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "Nama, email, dan password wajib diisi" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // simpan user
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at, updated_at, deleted_at`,
      [name, email, passwordHash]
    );
    const user = userRes.rows[0];

    // simpan role (kalau ada)
    if (Array.isArray(role_ids) && role_ids.length > 0) {
      const values = role_ids.map((rid, idx) => `($1, $${idx + 2})`).join(",");
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [user.id, ...role_ids]
      );
    }

    res.status(201).json(user);
  } catch (err) {
    console.error("POST /api/users error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Email sudah digunakan user lain" });
    }

    res.status(500).json({ message: "Gagal membuat user" });
  }
});


app.put("/api/users/:id", async (req, res) => {
  const id = req.params.id;
  const { name, email, password, role_ids } = req.body;

  if (!name || !email) {
    return res
      .status(400)
      .json({ message: "Nama dan email wajib diisi" });
  }

  try {
    let passwordPart = "";
    const params = [name, email, id];
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      passwordPart = ", password_hash = $4";
      params.push(passwordHash);
    }

    const updateQuery = `
      UPDATE users
      SET name = $1,
          email = $2,
          updated_at = NOW()
          ${passwordPart}
      WHERE id = $3
      AND deleted_at IS NULL
      RETURNING id, name, email, created_at, updated_at, deleted_at
    `;

    const result = await pool.query(updateQuery, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    const user = result.rows[0];

    // update roles: hapus dulu lalu insert ulang
    if (Array.isArray(role_ids)) {
      await pool.query("DELETE FROM user_roles WHERE user_id = $1", [id]);

      if (role_ids.length > 0) {
        const values = role_ids
          .map((rid, idx) => `($1, $${idx + 2})`)
          .join(",");
        await pool.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ${values}`,
          [id, ...role_ids]
        );
      }
    }

    res.json(user);
  } catch (err) {
    console.error("PUT /api/users/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Email sudah digunakan user lain" });
    }

    res.status(500).json({ message: "Gagal mengubah user" });
  }
});


// SOFT DELETE
app.delete("/api/users/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "User tidak ditemukan atau sudah dihapus" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus user" });
  }
});

// RESTORE
app.post("/api/users/:id/restore", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE users
       SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id, name, email, created_at, updated_at, deleted_at`,
      [id]
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "User tidak ditemukan atau belum dihapus" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/users/:id/restore error:", err);
    res.status(500).json({ message: "Gagal me-restore user" });
  }
});



// ====== KODE MATA ANGGARAN (KMA) ======

// GET semua KMA, bisa difilter per sumber dana
app.get("/api/budget-codes", async (req, res) => {
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
app.post("/api/budget-codes", async (req, res) => {
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
app.put("/api/budget-codes/:id", async (req, res) => {
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
app.delete("/api/budget-codes/:id", async (req, res) => {
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




// ====== LISTEN ======
app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});
