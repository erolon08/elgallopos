const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { todos } = req.query;
  const sql = todos === '1' ? 'SELECT * FROM cerrajeros ORDER BY nombre' : 'SELECT * FROM cerrajeros WHERE activo = 1 ORDER BY nombre';
  res.json(db.prepare(sql).all());
});

router.post('/', (req, res) => {
  const { nombre, porcentaje_rendicion, aporte_fijo } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const info = db
    .prepare(
      `INSERT INTO cerrajeros (nombre, porcentaje_rendicion, aporte_fijo)
       VALUES (@nombre, @porcentaje_rendicion, @aporte_fijo)`
    )
    .run({
      nombre: nombre.trim(),
      porcentaje_rendicion: porcentaje_rendicion != null ? Number(porcentaje_rendicion) : 30,
      aporte_fijo: Number(aporte_fijo) || 0,
    });
  res.status(201).json(db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cerrajero = db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(id);
  if (!cerrajero) return res.status(404).json({ error: 'Cerrajero no encontrado' });

  const { nombre, porcentaje_rendicion, aporte_fijo, activo } = req.body;
  db.prepare(
    `UPDATE cerrajeros SET
       nombre = @nombre, porcentaje_rendicion = @porcentaje_rendicion,
       aporte_fijo = @aporte_fijo, activo = @activo
     WHERE id = @id`
  ).run({
    id,
    nombre: (nombre ?? cerrajero.nombre).trim(),
    porcentaje_rendicion: porcentaje_rendicion != null ? Number(porcentaje_rendicion) : cerrajero.porcentaje_rendicion,
    aporte_fijo: aporte_fijo != null ? Number(aporte_fijo) : cerrajero.aporte_fijo,
    activo: activo != null ? (activo ? 1 : 0) : cerrajero.activo,
  });
  res.json(db.prepare('SELECT * FROM cerrajeros WHERE id = ?').get(id));
});

module.exports = router;
