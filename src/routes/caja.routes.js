const express = require('express');
const cajaService = require('../services/caja.service');
const { emitVentaEvent } = require('../sockets');

const router = express.Router();

router.get('/turno-activo', (req, res) => {
  const { terminal } = req.query;
  if (!terminal) return res.status(400).json({ error: 'Falta terminal' });
  const turno = cajaService.turnoAbiertoDe(terminal);
  res.json(turno ? cajaService.obtener(turno.id) : null);
});

router.get('/', (req, res) => {
  const { terminal, estado } = req.query;
  res.json(cajaService.listar({ terminal, estado }));
});

router.get('/:id', (req, res) => {
  const turno = cajaService.obtener(Number(req.params.id));
  if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
  res.json(turno);
});

router.post('/abrir', (req, res) => {
  try {
    const turno = cajaService.abrirTurno(req.body);
    emitVentaEvent('caja:actualizada', turno);
    res.status(201).json(turno);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/movimientos', (req, res) => {
  try {
    const turno = cajaService.agregarMovimiento(Number(req.params.id), req.body);
    emitVentaEvent('caja:actualizada', turno);
    res.status(201).json(turno);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/cerrar', (req, res) => {
  try {
    const turno = cajaService.cerrarTurno(Number(req.params.id), req.body);
    emitVentaEvent('caja:actualizada', turno);
    res.json(turno);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
