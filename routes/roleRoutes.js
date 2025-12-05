// routes/roleRoutes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET semua role + daftar permission-nya
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         r.id,
         r.name,
         r.slug,
         r.description,
         r.created_at,
         r.updated_at,
         COALESCE(
           json_agg(
             DISTINCT jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'slug', p.slug,
               'group_name', p.group_name
             )
           ) FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id
       ORDER BY r.name ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/roles error:", err);
    res.status(500).json({ message: "Gagal mengambil data role" });
  }
});

// CREATE role + permission_ids
router.post("/", async (req, res) => {
  const { name, slug, description, permission_ids } = req.body;

  if (!name || !slug) {
    return res
      .status(400)
      .json({ message: "Nama dan slug role wajib diisi" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const roleRes = await client.query(
      `INSERT INTO roles (name, slug, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, description, created_at, updated_at`,
      [name, slug, description || null]
    );
    const role = roleRes.rows[0];

    if (Array.isArray(permission_ids) && permission_ids.length > 0) {
      const values = permission_ids
        .map((pid, idx) => `($1, $${idx + 2})`)
        .join(",");
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [role.id, ...permission_ids]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(role);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/roles error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Nama atau slug role sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal membuat role" });
  } finally {
    client.release();
  }
});

// UPDATE role + permission_ids
router.put("/:id", async (req, res) => {
  const id = req.params.id;
  const { name, slug, description, permission_ids } = req.body;

  if (!name || !slug) {
    return res
      .status(400)
      .json({ message: "Nama dan slug role wajib diisi" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
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
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Role tidak ditemukan" });
    }

    const role = result.rows[0];

    if (Array.isArray(permission_ids)) {
      // reset dulu
      await client.query(
        "DELETE FROM role_permissions WHERE role_id = $1",
        [id]
      );

      if (permission_ids.length > 0) {
        const values = permission_ids
          .map((pid, idx) => `($1, $${idx + 2})`)
          .join(",");
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [id, ...permission_ids]
        );
      }
    }

    await client.query("COMMIT");
    res.json(role);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/roles/:id error:", err);

    if (err.code === "23505") {
      return res
        .status(409)
        .json({ message: "Nama atau slug role sudah digunakan" });
    }

    res.status(500).json({ message: "Gagal mengubah role" });
  } finally {
    client.release();
  }
});

// DELETE role
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await pool.query(
      "DELETE FROM roles WHERE id = $1",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Role tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/roles/:id error:", err);
    res.status(500).json({ message: "Gagal menghapus role" });
  }
});

export default router;
