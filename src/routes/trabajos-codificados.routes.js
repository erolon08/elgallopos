const express = require('express');
const service = require('../services/trabajos-codificados.service');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(service.listar({ soloActivos: req.query.activos === '1' }));
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(service.crear(req.body));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un trabajo con ese nombre' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const trabajo = service.actualizar(Number(req.params.id), req.body);
    if (!trabajo) return res.status(404).json({ error: 'Trabajo no encontrado' });
    res.json(trabajo);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un trabajo con ese nombre' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const ok = service.eliminar(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Trabajo no encontrado' });
  res.status(204).end();
});

module.exports = router;
