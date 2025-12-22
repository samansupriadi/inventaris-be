// migrate.js
import pool from "./db.js";

const migrate = async () => {
  const client = await pool.connect();

  try {
    console.log("⏳ Memulai Migrasi Database (Laravel Style)...");
    await client.query("BEGIN");

    // ==========================================
    // 1. MASTER DATA (Level Paling Atas)
    // ==========================================
    
    // Tabel: Entities (Entitas/Unit)
    console.log("Creating table: entities...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS entities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel: Locations (Lokasi)
    console.log("Creating table: locations...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE, 
        code VARCHAR(50) UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel: Asset Categories (Kategori Aset)
    console.log("Creating table: asset_categories...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS asset_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        code VARCHAR(50) UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel: Funding Sources (Sumber Dana)
    console.log("Creating table: funding_sources...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS funding_sources (
        id SERIAL PRIMARY KEY,
        entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        code VARCHAR(50) UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel: Budget Codes (Kode Mata Anggaran)
    console.log("Creating table: budget_codes...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS budget_codes (
        id SERIAL PRIMARY KEY,
        funding_source_id INTEGER REFERENCES funding_sources(id) ON DELETE CASCADE,
        code VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(funding_source_id, code)
      );
    `);

    // ==========================================
    // 2. USER MANAGEMENT & RBAC
    // ==========================================

    // Tabel: Users
    console.log("Creating table: users...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        entity_id INTEGER REFERENCES entities(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
    `);

    // Tabel: Roles
    console.log("Creating table: roles...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel: Permissions
    console.log("Creating table: permissions...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        group_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Tabel Pivot: User Roles
    console.log("Creating table: user_roles...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );
    `);

    // Tabel Pivot: Role Permissions
    console.log("Creating table: role_permissions...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
    `);

    // ==========================================
    // 3. IMPORT HISTORY
    // ==========================================
    console.log("Creating table: import_histories...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_histories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        filename TEXT NOT NULL,
        total_rows INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // ==========================================
    // 4. CORE DATA (ASSETS)
    // ==========================================
    console.log("Creating table: assets...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS assets (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(100) UNIQUE NOT NULL,
        
        -- Foreign Keys
        category_id INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL,
        location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
        funding_source_id INTEGER REFERENCES funding_sources(id) ON DELETE SET NULL,
        budget_code_id INTEGER REFERENCES budget_codes(id) ON DELETE SET NULL,
        import_history_id INTEGER REFERENCES import_histories(id) ON DELETE SET NULL,

        -- Details
        condition VARCHAR(50), -- baik, rusak, maintenance
        status VARCHAR(50) DEFAULT 'available', -- available, borrowed, lost
        value NUMERIC(18, 2) DEFAULT 0,
        purchase_date DATE,
        
        -- Files
        photo_url TEXT,
        receipt_url TEXT,
        notes TEXT,
        
        sequence_no INTEGER, -- untuk running number
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP -- Soft Delete
      );
    `);

    // ==========================================
    // 5. TRANSACTIONS (LOANS & OPNAME)
    // ==========================================

    // Tabel: Loans (Peminjaman)
    console.log("Creating table: loans...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id SERIAL PRIMARY KEY,
        asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        borrower_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        usage_location_id INTEGER REFERENCES locations(id),
        
        borrower VARCHAR(255), -- Nama peminjam text manual (backup)
        borrowed_at TIMESTAMP DEFAULT NOW(),
        due_date DATE,
        returned_at TIMESTAMP,
        
        status VARCHAR(50) DEFAULT 'borrowed', -- borrowed, returned
        
        condition_before VARCHAR(50),
        condition_after VARCHAR(50),
        before_photo_url TEXT,
        after_photo_url TEXT,
        
        notes TEXT,
        notes_return TEXT
      );
    `);

    // Tabel: Opname Sessions (Audit Header)
    console.log("Creating table: opname_sessions...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS opname_sessions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'On Progress',
        location_id INTEGER REFERENCES locations(id),
        created_by INTEGER REFERENCES users(id),
        verified_by INTEGER REFERENCES users(id),
        
        total_assets INTEGER DEFAULT 0,
        scanned_assets INTEGER DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT NOW(),
        finalized_at TIMESTAMP
      );
    `);

    // Tabel: Opname Items (Audit Detail)
    console.log("Creating table: opname_items...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS opname_items (
        id SERIAL PRIMARY KEY,
        opname_session_id INTEGER REFERENCES opname_sessions(id) ON DELETE CASCADE,
        asset_id INTEGER REFERENCES assets(id),
        
        status VARCHAR(50) DEFAULT 'Missing', -- Matched, Missing, Unlisted
        condition_actual VARCHAR(50),
        notes TEXT,
        
        scanned_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("✅ MIGRASI SUKSES! Database siap digunakan di Production.");
    
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Gagal Migrasi:", err);
  } finally {
    client.release();
    process.exit();
  }
};

migrate();