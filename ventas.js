import express from "express";

export default function ventasRoutes(pool) {

  const router = express.Router();

  // ============================
  // CREAR VEHICULO VENDIDO
  // ============================
  router.post("/ventas", async (req, res) => {
  try {
    const {
      marca,
      modelo,
      ano,
      color,
      chasis,
      precio_venta,
      fecha_venta,
      imagen,
      numero_venta
    } = req.body;

    const precioNumero = Number(precio_venta);
    const precioFinal = Number.isFinite(precioNumero) ? precioNumero : 0;

    let numeroFinal;

    if (numero_venta) {
      numeroFinal = Number(numero_venta);
    } else {
      const numero = await pool.query(`
        SELECT COALESCE(MAX(numero_venta),0) + 1 AS siguiente
        FROM vehiculos_venta
      `);
      numeroFinal = numero.rows[0].siguiente;
    }

    const r = await pool.query(
      `INSERT INTO vehiculos_venta
      (marca, modelo, ano, color, chasis, precio_venta, fecha_venta, imagen, numero_venta)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        marca,
        modelo,
        ano,
        color,
        chasis,
        precioFinal,
        fecha_venta,
        imagen,
        numeroFinal
      ]
    );

    res.json(r.rows[0]);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.put("/ventas/:id/numero", async (req, res) => {
  try {
    const { id } = req.params;
    const { numero_venta } = req.body;

    if (!numero_venta) {
      return res.status(400).json({ error: "Número requerido" });
    }

    await pool.query(
      "UPDATE vehiculos_venta SET numero_venta = $1 WHERE id = $2",
      [Number(numero_venta), id]
    );

    res.json({ ok: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
  // ============================
  // AGREGAR GASTO
  // ============================
  router.post("/ventas/:id/gastos", async (req, res) => {
    try {
      const { descripcion, fecha, monto } = req.body;
      const { id } = req.params;
      const montoNumero = Number(monto);
      const montoFinal = Number.isFinite(montoNumero) ? montoNumero : 0;

      const r = await pool.query(
        `INSERT INTO gastos_vehiculo
        (vehiculo_id, descripcion, fecha, monto)
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [id, descripcion, fecha, montoFinal]
      );

      res.json(r.rows[0]);

    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================
  // AGREGAR PAGO EXTRA
  // ============================
  router.post("/ventas/:id/pagos", async (req, res) => {
    try {
      const { descripcion, fecha, monto } = req.body;
      const { id } = req.params;

      const montoNumero = Number(monto);
      const montoFinal = Number.isFinite(montoNumero) ? montoNumero : 0;
      const r = await pool.query(
        `INSERT INTO pagos_vehiculo
        (vehiculo_id, descripcion, fecha, monto)
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [id, descripcion, fecha, montoFinal]
      );

      res.json(r.rows[0]);

    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
// ============================
// ELIMINAR VENTA COMPLETA
// ============================
router.delete("/ventas/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `DELETE FROM vehiculos_venta WHERE id = $1`,
      [id]
    );

    res.json({ message: "Venta eliminada correctamente" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});
// ============================
// OBTENER DETALLE COMPLETO
// ============================
router.get("/ventas/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const vehiculo = await pool.query(
      `SELECT * FROM vehiculos_venta WHERE id = $1`,
      [id]
    );

    if (vehiculo.rows.length === 0) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    const gastos = await pool.query(
      `SELECT * FROM gastos_vehiculo
       WHERE vehiculo_id = $1
       ORDER BY id ASC`,
      [id]
    );

    const pagos = await pool.query(
      `SELECT * FROM pagos_vehiculo
       WHERE vehiculo_id = $1
       ORDER BY id ASC`,
      [id]
    );

    res.json({
      vehiculo: vehiculo.rows[0],
      gastos: gastos.rows,
      pagos: pagos.rows
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.delete("/ventas-gastos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM gastos_vehiculo WHERE id=$1", [id]);
    res.json({ message: "Gasto eliminado ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.delete("/ventas-pagos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM pagos_vehiculo WHERE id=$1", [id]);
    res.json({ message: "Pago eliminado ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
  // ============================
  // RESUMEN COMPLETO AUTOMATICO
  // ============================
  router.get("/ventas-resumen", async (req, res) => {
    try {

      const vehiculos = await pool.query(`
        SELECT
  v.id,
  v.marca,
  v.modelo,
  v.ano,
  v.precio_venta,

  COALESCE(g.total_gastos,0) AS total_gastos,
  COALESCE(p.total_pagos,0) AS total_pagos,

  (v.precio_venta - COALESCE(g.total_gastos,0)) AS restante,

  (
    v.precio_venta
    - COALESCE(g.total_gastos,0)
    - COALESCE(p.total_pagos,0)
  ) AS ganancia_limpia

FROM vehiculos_venta v

LEFT JOIN (
  SELECT vehiculo_id, SUM(monto) AS total_gastos
  FROM gastos_vehiculo
  GROUP BY vehiculo_id
) g ON g.vehiculo_id = v.id

LEFT JOIN (
  SELECT vehiculo_id, SUM(monto) AS total_pagos
  FROM pagos_vehiculo
  GROUP BY vehiculo_id
) p ON p.vehiculo_id = v.id

ORDER BY v.id DESC;
      `);

      const totalVendido = await pool.query(`
        SELECT COALESCE(SUM(precio_venta),0) AS total FROM vehiculos_venta
      `);

      const totalGastos = await pool.query(`
        SELECT COALESCE(SUM(monto),0) AS total FROM gastos_vehiculo
      `);

      const totalPagos = await pool.query(`
        SELECT COALESCE(SUM(monto),0) AS total FROM pagos_vehiculo
      `);

      res.json({
        vehiculos: vehiculos.rows,
        total_vendido: totalVendido.rows[0].total,
        total_gastos: totalGastos.rows[0].total,
        total_pagos: totalPagos.rows[0].total,
        total_limpio:
          totalVendido.rows[0].total
          - totalGastos.rows[0].total
          - totalPagos.rows[0].total
      });

    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}