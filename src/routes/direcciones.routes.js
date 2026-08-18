const express = require('express');
const direccionesService = require('../services/direcciones.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(direccionesService.listar(req.query.estado));
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(direccionesService.crear(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/convertir', (req, res) => {
  const id = Number(req.params.id);
  const ok = direccionesService.marcarConvertida(id);
  if (!ok) return res.status(404).json({ error: 'No encontrada o ya convertida' });
  res.json(direccionesService.obtener(id));
});

router.delete('/:id', (req, res) => {
  const ok = direccionesService.eliminar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'No encontrada' });
  res.status(204).end();
});

module.exports = router;
