// seed.js
import pool from "./db.js";
import bcrypt from "bcrypt";

// Cek apakah user menjalankan dengan flag --fresh
const isFresh = process.argv.includes("--fresh");

const seed = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =================================================
    // 0. MEMBERSIHKAN DATABASE (Jika mode --fresh)
    // =================================================
    if (isFresh) {
      console.log("🧹 Membersihkan seluruh data database (Fresh Mode)...");
      
      const tables = [
        "loans",
        "assets",
        "user_roles",
        "role_permissions",
        "users",
        "roles",
        "permissions",
        "funding_sources",
        "locations",
        "asset_categories", 
        "entities",
        "budget_codes"      
      ];

      await client.query(
        `TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`
      );
      console.log("✨ Database bersih kinclong!");
    }

    console.log("🌱 Mulai Seeding Data...");

    // =================================================
    // 1. SEED PERMISSIONS (SUPER LENGKAP)
    // =================================================
    const permissions = [
      // 1. DASHBOARD
      { name: "Lihat Dashboard", slug: "view_dashboard", group: "Dashboard" },

      // 2. ASET & INVENTARIS
      { name: "Lihat Aset", slug: "view_assets", group: "Assets" },
      { name: "Tambah Aset", slug: "create_assets", group: "Assets" },
      { name: "Edit Aset", slug: "edit_assets", group: "Assets" },
      { name: "Hapus Aset", slug: "delete_assets", group: "Assets" },
      { name: "Pinjam Aset", slug: "borrow_assets", group: "Assets" },
      { name: "Kembalikan Aset", slug: "return_assets", group: "Assets" },

      // 3. MASTER DATA - ENTITAS
      { name: "Lihat Entitas", slug: "view_entities", group: "Master Data" },
      { name: "Tambah Entitas", slug: "create_entities", group: "Master Data" },
      { name: "Edit Entitas", slug: "edit_entities", group: "Master Data" },
      { name: "Hapus Entitas", slug: "delete_entities", group: "Master Data" },

      // 4. MASTER DATA - LOKASI
      { name: "Lihat Lokasi", slug: "view_locations", group: "Master Data" },
      { name: "Tambah Lokasi", slug: "create_locations", group: "Master Data" },
      { name: "Edit Lokasi", slug: "edit_locations", group: "Master Data" },
      { name: "Hapus Lokasi", slug: "delete_locations", group: "Master Data" },

      // 5. MASTER DATA - KATEGORI ASET
      { name: "Lihat Kategori", slug: "view_categories", group: "Master Data" },
      { name: "Tambah Kategori", slug: "create_categories", group: "Master Data" },
      { name: "Edit Kategori", slug: "edit_categories", group: "Master Data" },
      { name: "Hapus Kategori", slug: "delete_categories", group: "Master Data" },

      // 6. MASTER DATA - SUMBER DANA
      { name: "Lihat Sumber Dana", slug: "view_funding_sources", group: "Master Data" },
      { name: "Tambah Sumber Dana", slug: "create_funding_sources", group: "Master Data" },
      { name: "Edit Sumber Dana", slug: "edit_funding_sources", group: "Master Data" },
      { name: "Hapus Sumber Dana", slug: "delete_funding_sources", group: "Master Data" },

      // 7. PENGATURAN - USERS
      { name: "Lihat User", slug: "view_users", group: "Settings" },
      { name: "Tambah User", slug: "create_users", group: "Settings" },
      { name: "Edit User", slug: "edit_users", group: "Settings" },
      { name: "Hapus User", slug: "delete_users", group: "Settings" },

      // 8. PENGATURAN - ROLES
      { name: "Lihat Role", slug: "view_roles", group: "Settings" },
      { name: "Tambah Role", slug: "create_roles", group: "Settings" },
      { name: "Edit Role", slug: "edit_roles", group: "Settings" },
      { name: "Hapus Role", slug: "delete_roles", group: "Settings" },

      // 9. PENGATURAN - PERMISSIONS
      { name: "Lihat Permission", slug: "view_permissions", group: "Settings" },
      { name: "Tambah Permission", slug: "create_permissions", group: "Settings" },
      { name: "Edit Permission", slug: "edit_permissions", group: "Settings" },
      { name: "Hapus Permission", slug: "delete_permissions", group: "Settings" },
      // 10. IMPORT DATA
      { name: "Import Data Excel", slug: "import_data", group: "Settings" },
    ];

    console.log(`... Mengisi ${permissions.length} permissions`);

    for (const p of permissions) {
      await client.query(
        `INSERT INTO permissions (name, slug, group_name) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (slug) DO UPDATE SET 
           name = EXCLUDED.name, 
           group_name = EXCLUDED.group_name`, 
        [p.name, p.slug, p.group]
      );
    }

    // =================================================
    // 2. SEED ROLES
    // =================================================
    console.log("... Mengisi Roles");
    
    // Role: Super Admin (Slug: admin / super_admin)
    const adminRoleRes = await client.query(
      `INSERT INTO roles (name, slug, description) 
       VALUES ('Super Admin', 'admin', 'Full Akses Sistem') 
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const adminRoleId = adminRoleRes.rows[0]?.id || 
      (await client.query("SELECT id FROM roles WHERE slug = 'admin'")).rows[0].id;

    // Role: Staff (Contoh role terbatas)
    await client.query(
      `INSERT INTO roles (name, slug, description) 
       VALUES ('Staff Gudang', 'staff', 'Hanya bisa lihat dan edit aset') 
       ON CONFLICT (slug) DO NOTHING`
    );

    // =================================================
    // 3. ASSIGN ALL PERMISSIONS TO ADMIN
    // =================================================
    console.log("... Memberikan SEMUA permission ke Super Admin");
    
    const allPerms = await client.query("SELECT id FROM permissions");
    
    // Reset dulu permission admin biar bersih (kalau seed biasa)
    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [adminRoleId]);

    const values = allPerms.rows.map((p, i) => `($1, $${i + 2})`).join(",");
    if (values) {
        await client.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
            [adminRoleId, ...allPerms.rows.map(p => p.id)]
        );
    }

    // =================================================
    // 4. SEED DEFAULT USER
    // =================================================
    console.log("... Membuat User Default");

    const email = "admin@sinergifoundation.org";
    const password = "password123"; 
    const passwordHash = await bcrypt.hash(password, 10);

    const userRes = await client.query(
      `INSERT INTO users (name, email, password_hash) 
       VALUES ('Super Admin', $1, $2) 
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [email, passwordHash]
    );
    
    const userId = userRes.rows[0]?.id || 
      (await client.query("SELECT id FROM users WHERE email = $1", [email])).rows[0].id;

    // Assign Role Admin ke User ini
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING`,
      [userId, adminRoleId]
    );

    await client.query("COMMIT");
    console.log("✅ SEEDING SELESAI!");
    if (isFresh) {
        console.log("🚀 Database sudah di-reset ulang (Fresh).");
    }
    console.log(`🔑 Login: ${email} | Pass: ${password}`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Gagal Seeding:", err);
  } finally {
    client.release();
    process.exit();
  }
};

seed();