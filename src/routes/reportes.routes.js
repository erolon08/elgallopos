const express = require('express');
const reportesService = require('../services/reportes.service');
const cajaService = require('../services/caja.service');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  const { anio, mes, tipo_egreso, forma_pago } = req.query;
  res.json(reportesService.dashboard({ anio, mes, tipo_egreso, forma_pago }));
});

router.get('/anios-disponibles', (req, res) => {
  res.json(reportesService.aniosDisponibles());
});

router.get('/consulta', (req, res) => {
  const { producto_id, familia_id, anio, mes, desde, hasta } = req.query;
  if (producto_id) {
    return res.json({ tipo: 'producto', ...reportesService.consultaProducto({ producto_id: Number(producto_id), anio, mes, desde, hasta }) });
  }
  if (familia_id) {
    return res.json({ tipo: 'familia', ...reportesService.consultaFamilia({ familia_id: Number(familia_id), anio, mes, desde, hasta }) });
  }
  res.status(400).json({ error: 'Debés indicar un producto o una familia' });
});

router.post('/gasto-manual', (req, res) => {
  try {
    const turno = cajaService.agregarGastoRapido(req.body);
    res.status(201).json(turno);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
