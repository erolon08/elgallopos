const express = require('express');
const presupuestosService = require('../services/presupuestos.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(presupuestosService.listar({ estado: req.query.estado }));
});

router.get('/:id', (req, res) => {
  const presupuesto = presupuestosService.obtener(Number(req.params.id));
  if (!presupuesto) return res.status(404).json({ error: 'Presupuesto no encontrado' });
  res.json(presupuesto);
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(presupuestosService.crear(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', (req, res) => {
  presupuestosService.borrarTodos();
  res.status(204).end();
});

router.post('/:id/cerrar', (req, res) => {
  const ok = presupuestosService.cerrar(Number(req.params.id));
  if (!ok) return res.status(400).json({ error: 'El presupuesto no se puede cerrar (ya no está vigente)' });
  res.status(204).end();
});

module.exports = router;
