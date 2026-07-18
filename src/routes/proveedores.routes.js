const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre').all());
});

router.post('/', (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  try {
    const info = db.prepare('INSERT INTO proveedores (nombre) VALUES (?)').run(nombre.trim());
    res.status(201).json(db.prepare('SELECT * FROM proveedores WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un proveedor con ese nombre' });
    }
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
