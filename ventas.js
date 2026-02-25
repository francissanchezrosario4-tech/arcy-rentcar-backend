import express from "express";

export default function ventasRoutes(pool) {

  const router = express.Router();

  // ============================
  // CREAR VEHICULO VENDIDO
  // ============================
  router.post("/ventas", async (req, res) => {
    try {
     const { marca, modelo, ano, color, chasis, precio_venta, fecha_venta, imagen } = req.body;

      const r = await pool.query(
        `INSERT INTO vehiculos_venta
        (marca, modelo, ano, color, chasis, precio_venta, fecha_venta, imagen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [marca, modelo, ano, color, chasis, precio_venta, fecha_venta, imagen]
      );

      res.json(r.rows[0]);

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

      const r = await pool.query(
        `INSERT INTO gastos_vehiculo
        (vehiculo_id, descripcion, fecha, monto)
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [id, descripcion, fecha, monto]
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

      const r = await pool.query(
        `INSERT INTO pagos_vehiculo
        (vehiculo_id, descripcion, fecha, monto)
        VALUES ($1,$2,$3,$4)
        RETURNING *`,
        [id, descripcion, fecha, monto]
      );

      res.json(r.rows[0]);

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

          COALESCE(SUM(g.monto),0) AS total_gastos,
          COALESCE(SUM(p.monto),0) AS total_pagos,

          (v.precio_venta - COALESCE(SUM(g.monto),0)) AS restante,

          (v.precio_venta
            - COALESCE(SUM(g.monto),0)
            - COALESCE(SUM(p.monto),0)
          ) AS ganancia_limpia

        FROM vehiculos_venta v
        LEFT JOIN gastos_vehiculo g ON g.vehiculo_id = v.id
        LEFT JOIN pagos_vehiculo p ON p.vehiculo_id = v.id
        GROUP BY v.id
        ORDER BY v.id DESC
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