const express = require('express');
const reportesService = require('../services/reportes.service');
const cajaService = require('../services/caja.service');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  const { anio, mes, tipo_egreso, forma_pago } = req.query;
  res.json(reportesService.dashboard({ anio, mes, tipo_egreso, forma_pago }));
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
