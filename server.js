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

/* ===== ADMIN GUARD (opcional) =====
   Si configuras ADMIN_KEY en Render, los DELETE quedan protegidos.
*/
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_KEY) return next(); // si no existe, no bloquea

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

/* 🔒 FK RESTRICT: si tiene facturas, no se puede borrar */
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
    const r = await pool.query(`
      WITH renta_activa AS (
        SELECT
          r.vehiculo_id,
          r.factura_id,
          r.fecha_inicio,
          r.fecha_fin,
          f.cliente_nombre,
          ROW_NUMBER() OVER (PARTITION BY r.vehiculo_id ORDER BY r.fecha_inicio ASC) AS rn
        FROM rentas r
        LEFT JOIN facturas f ON f.id = r.factura_id
        WHERE r.estado = 'activa'
          AND CURRENT_DATE BETWEEN r.fecha_inicio AND r.fecha_fin
      ),
      renta_pendiente AS (
        SELECT
          r.vehiculo_id,
          r.factura_id,
          r.fecha_inicio,
          r.fecha_fin,
          f.cliente_nombre,
          ROW_NUMBER() OVER (PARTITION BY r.vehiculo_id ORDER BY r.fecha_inicio ASC) AS rn
        FROM rentas r
        LEFT JOIN facturas f ON f.id = r.factura_id
        WHERE r.estado = 'activa'
          AND r.fecha_inicio > CURRENT_DATE
      )
      SELECT
        v.*,

        CASE
          WHEN LOWER(v.estado) = 'mantenimiento' THEN 'Mantenimiento'
          WHEN a.vehiculo_id IS NOT NULL THEN 'Rentado'
          WHEN p.vehiculo_id IS NOT NULL THEN 'Pendiente'
          ELSE 'Disponible'
        END AS estado_calculado,

        -- info de renta que se mostrará en dashboard (activa tiene prioridad)
        COALESCE(a.fecha_inicio, p.fecha_inicio) AS renta_inicio,
        COALESCE(a.fecha_fin, p.fecha_fin) AS renta_fin,
        COALESCE(a.cliente_nombre, p.cliente_nombre) AS renta_cliente,
        COALESCE(a.factura_id, p.factura_id) AS renta_factura_id,

        CASE
          WHEN a.vehiculo_id IS NOT NULL THEN 'activa'
          WHEN p.vehiculo_id IS NOT NULL THEN 'pendiente'
          ELSE NULL
        END AS renta_tipo

      FROM vehiculos v
      LEFT JOIN renta_activa a ON a.vehiculo_id = v.id AND a.rn = 1
      LEFT JOIN renta_pendiente p ON p.vehiculo_id = v.id AND p.rn = 1
      ORDER BY v.id DESC;
    `);

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

/* 🔒 FK RESTRICT: si tiene facturas/rentas, no se puede borrar */
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
   FACTURAS + RENTAS (ATÓMICO)
======================= */
app.get("/facturas", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        f.*,
        r.fecha_inicio,
        r.fecha_fin,
        r.estado AS renta_estado,
        r.extras AS renta_extras
      FROM facturas f
      LEFT JOIN rentas r
        ON r.factura_id = f.id
      ORDER BY f.fecha DESC, f.created_at DESC
    `);
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
 * Requiere: cliente_id, vehiculo_id, fecha, fecha_inicio, fecha_fin, dias, precio_dia, total
 * Genera id si no viene.
 * Inserta factura + renta en una sola transacción.
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
    extras,
    total,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Obtener cliente/vehículo para snapshot
    const c = await client.query("SELECT * FROM clientes WHERE id=$1", [cliente_id]);
    if (c.rows.length === 0) throw new Error("Cliente no encontrado");

    const v = await client.query("SELECT * FROM vehiculos WHERE id=$1", [vehiculo_id]);
    if (v.rows.length === 0) throw new Error("Vehículo no encontrado");

    // 2) Validar disponibilidad (no solape)
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

    // 3) Insert factura
    await client.query(
      `
      INSERT INTO facturas
      (id, fecha, cliente_id, cliente_nombre, cliente_telefono, vehiculo_id, vehiculo, placa, dias, precio_dia, extras, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        Number(extras ?? 0),
        Number(total ?? 0),
      ]
    );

    // 4) Insert renta ligada a factura (FK)
    await client.query(
      `
      INSERT INTO rentas (factura_id, vehiculo_id, fecha_inicio, fecha_fin, extras, estado)
      VALUES ($1,$2,$3,$4,$5,'activa')
      `,
      [facturaId, vehiculo_id, fecha_inicio, fecha_fin, Number(extras ?? 0)]
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
 * Borra solo la factura. La renta se borra sola por FK CASCADE (si está configurado).
 * Si no tienes cascade, igual funciona porque no depende de rentas.
 */
app.delete("/facturas/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM facturas WHERE id=$1", [id]);
    res.json({ status: "Factura eliminada ✅" });
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

