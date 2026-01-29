import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== MIDDLEWARE ===== */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
  })
);
app.use(express.json());

/* ===== DATABASE ===== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ===== ADMIN GUARD (recomendado) =====
   Si pones ADMIN_KEY en Render, los DELETE quedan protegidos.
*/
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_KEY) return next();
  const key = req.headers["x-admin-key"];
  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

/* =======================
   HEALTH + TESTS
======================= */
app.get("/", (req, res) => {
  res.json({ status: "Servidor Arcy Rent Car ONLINE 🚗🔥" });
});

app.get("/test-db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ database: "OK", time: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   CLIENTES
======================= */
app.get("/clientes", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/clientes", async (req, res) => {
  const { nombre, telefono, cedula, nota, valoracion } = req.body;

  try {
    const r = await pool.query(
      `
      INSERT INTO clientes (nombre, telefono, cedula, nota, valoracion)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [nombre, telefono || "", cedula || "", nota || "", Number(valoracion ?? 5)]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/clientes/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, cedula, nota, valoracion } = req.body;

  try {
    const r = await pool.query(
      `
      UPDATE clientes
      SET nombre=$1, telefono=$2, cedula=$3, nota=$4, valoracion=$5
      WHERE id=$6
      RETURNING *
      `,
      [nombre, telefono || "", cedula || "", nota || "", Number(valoracion ?? 5), id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Cliente no encontrado" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* 🔒 No se borra si tiene facturas (FK RESTRICT) */
app.delete("/clientes/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM clientes WHERE id=$1", [id]);
    res.json({ status: "Cliente eliminado ✅" });
  } catch (e) {
    if (e.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el cliente tiene facturas asociadas." });
    }
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   VEHICULOS
======================= */
app.get("/vehiculos", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM vehiculos ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/vehiculos", async (req, res) => {
  const { marca, modelo, ano, placa, estado, precio_dia, imagen } = req.body;

  try {
    const r = await pool.query(
      `
      INSERT INTO vehiculos (marca, modelo, ano, placa, estado, precio_dia, imagen)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        marca,
        modelo,
        ano ?? null,
        placa,
        estado ?? "Disponible",
        Number(precio_dia ?? 0),
        imagen || "",
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/vehiculos/:id", async (req, res) => {
  const { id } = req.params;
  const { marca, modelo, ano, placa, estado, precio_dia, imagen } = req.body;

  try {
    const r = await pool.query(
      `
      UPDATE vehiculos
      SET marca=$1, modelo=$2, ano=$3, placa=$4, estado=$5, precio_dia=$6, imagen=$7
      WHERE id=$8
      RETURNING *
      `,
      [
        marca,
        modelo,
        ano ?? null,
        placa,
        estado ?? "Disponible",
        Number(precio_dia ?? 0),
        imagen || "",
        id,
      ]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Vehículo no encontrado" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* 🔒 No se borra si tiene facturas/rentas (FK RESTRICT) */
app.delete("/vehiculos/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM vehiculos WHERE id=$1", [id]);
    res.json({ status: "Vehículo eliminado ✅" });
  } catch (e) {
    if (e.code === "23503") {
      return res.status(409).json({ error: "No se puede eliminar: el vehículo tiene facturas/rentas asociadas." });
    }
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   FACTURAS + RENTAS
   ✅ Atómico y blindado (transacción)
======================= */

app.get("/facturas", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM facturas ORDER BY fecha DESC, created_at DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/rentas", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM rentas ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/disponibilidad/:vehiculo_id", async (req, res) => {
  const { vehiculo_id } = req.params;
  const { inicio, fin } = req.query;

  try {
    const r = await pool.query(
      `
      SELECT 1
      FROM rentas
      WHERE vehiculo_id = $1
        AND estado = 'activa'
        AND fecha_inicio <= $3
        AND fecha_fin >= $2
      LIMIT 1
      `,
      [vehiculo_id, inicio, fin]
    );

    res.json({ disponible: r.rows.length === 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /facturas
 * Espera: cliente_id, vehiculo_id, fecha, fecha_inicio, fecha_fin, dias, precio_dia, total
 * Genera id si no viene.
 */
app.post("/facturas", async (req, res) => {
  const {
    id,
    fecha,
    cliente_id,
    vehiculo_id,
    fecha_inicio,
    fecha_fin,
    dias,
    precio_dia,
    total,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Traer snapshot de cliente y vehículo
    const c = await client.query("SELECT * FROM clientes WHERE id=$1", [cliente_id]);
    if (c.rows.length === 0) throw new Error("Cliente no encontrado");

    const v = await client.query("SELECT * FROM vehiculos WHERE id=$1", [vehiculo_id]);
    if (v.rows.length === 0) throw new Error("Vehículo no encontrado");

    // Verificar disponibilidad
    const check = await client.query(
      `
      SELECT 1
      FROM rentas
      WHERE vehiculo_id = $1
        AND estado = 'activa'
        AND fecha_inicio <= $3
        AND fecha_fin >= $2
      LIMIT 1
      `,
      [vehiculo_id, fecha_inicio, fecha_fin]
    );
    if (check.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Vehículo no disponible en ese rango" });
    }

    const cliente = c.rows[0];
    const vehiculo = v.rows[0];

    const facturaId = id || `FAC-${Date.now()}`;

    // Insert factura (con ids + snapshot)
    await client.query(
      `
      INSERT INTO facturas
      (id, fecha, cliente_id, cliente_nombre, cliente_telefono, vehiculo_id, vehiculo, placa, dias, precio_dia, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        facturaId,
        fecha,
        cliente_id,
        cliente.nombre,
        cliente.telefono || "",
        vehiculo_id,
        `${vehiculo.marca} ${vehiculo.modelo}`.trim(),
        vehiculo.placa || "",
        Number(dias ?? 1),
        Number(precio_dia ?? vehiculo.precio_dia ?? 0),
        Number(total ?? 0),
      ]
    );

    // Insert renta ligada a factura (CASCADE)
    await client.query(
      `
      INSERT INTO rentas (factura_id, vehiculo_id, fecha_inicio, fecha_fin, estado)
      VALUES ($1,$2,$3,$4,'activa')
      `,
      [facturaId, vehiculo_id, fecha_inicio, fecha_fin]
    );

    await client.query("COMMIT");
    res.json({ status: "Factura y renta guardadas ✅", id: facturaId });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /facturas/:id
 * ✅ Solo borra factura (renta se borra sola por CASCADE)
 * 🔒 Protegido si configuras ADMIN_KEY
 */
app.delete("/facturas/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM facturas WHERE id=$1", [id]);
    res.json({ status: "Factura eliminada ✅ (renta por cascade)" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
