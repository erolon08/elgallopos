const express = require('express');
const agendaService = require('../services/agenda.service');

const router = express.Router();

router.get('/', (req, res) => {
  const { fecha, estado } = req.query;
  res.json(agendaService.listar({ fecha, estado }));
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(agendaService.crear(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/hecho', (req, res) => {
  try {
    res.json(agendaService.marcarHecho(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    agendaService.eliminar(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
