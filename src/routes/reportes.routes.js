const express = require('express');
const XLSX = require('xlsx');
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

router.get('/resumen-ventas', (req, res) => {
  const { desde, hasta } = req.query;
  res.json(reportesService.resumenVentas({ desde, hasta }));
});

router.get('/resumen-gastos', (req, res) => {
  const { desde, hasta } = req.query;
  res.json(reportesService.resumenGastos({ desde, hasta }));
});

router.get('/exportar-gastos', (req, res) => {
  const { desde, hasta } = req.query;
  const filas = reportesService.exportarFilasGastos({ desde, hasta });
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Gastos');
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  const nombre = `gastos_${desde || 'inicio'}_a_${hasta || 'hoy'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
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
