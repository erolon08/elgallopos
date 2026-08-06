const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const { soloActivas } = req.query;
  const sql = soloActivas === 'true'
    ? 'SELECT * FROM familias WHERE activo = 1 ORDER BY nombre'
    : 'SELECT * FROM familias ORDER BY nombre';
  res.json(db.prepare(sql).all());
});

router.post('/', (req, res) => {
  const { nombre, descuento_debito, descuento_efectivo, usa_precio_rendicion, usa_mano_obra, pregunta_pila } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO familias (nombre, descuento_debito, descuento_efectivo, usa_precio_rendicion, usa_mano_obra, pregunta_pila)
         VALUES (@nombre, @descuento_debito, @descuento_efectivo, @usa_precio_rendicion, @usa_mano_obra, @pregunta_pila)`
      )
      .run({
        nombre: nombre.trim().toUpperCase(),
        descuento_debito: Number(descuento_debito) || 0,
        descuento_efectivo: Number(descuento_efectivo) || 0,
        usa_precio_rendicion: usa_precio_rendicion ? 1 : 0,
        usa_mano_obra: usa_mano_obra ? 1 : 0,
        pregunta_pila: pregunta_pila ? 1 : 0,
      });
    res.status(201).json(db.prepare('SELECT * FROM familias WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe una familia con ese nombre' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const familia = db.prepare('SELECT * FROM familias WHERE id = ?').get(id);
  if (!familia) return res.status(404).json({ error: 'Familia no encontrada' });

  const { nombre, descuento_debito, descuento_efectivo, usa_precio_rendicion, usa_mano_obra, pregunta_pila, activo } = req.body;
  try {
    db.prepare(
      `UPDATE familias SET
         nombre = @nombre, descuento_debito = @descuento_debito, descuento_efectivo = @descuento_efectivo,
         usa_precio_rendicion = @usa_precio_rendicion, usa_mano_obra = @usa_mano_obra, pregunta_pila = @pregunta_pila,
         activo = @activo
       WHERE id = @id`
    ).run({
      id,
      nombre: (nombre ?? familia.nombre).trim().toUpperCase(),
      descuento_debito: descuento_debito != null ? Number(descuento_debito) : familia.descuento_debito,
      descuento_efectivo: descuento_efectivo != null ? Number(descuento_efectivo) : familia.descuento_efectivo,
      usa_precio_rendicion: usa_precio_rendicion != null ? (usa_precio_rendicion ? 1 : 0) : familia.usa_precio_rendicion,
      usa_mano_obra: usa_mano_obra != null ? (usa_mano_obra ? 1 : 0) : familia.usa_mano_obra,
      pregunta_pila: pregunta_pila != null ? (pregunta_pila ? 1 : 0) : familia.pregunta_pila,
      activo: activo != null ? (activo ? 1 : 0) : familia.activo,
    });
    res.json(db.prepare('SELECT * FROM familias WHERE id = ?').get(id));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe una familia con ese nombre' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const familia = db.prepare('SELECT * FROM familias WHERE id = ?').get(id);
  if (!familia) return res.status(404).json({ error: 'Familia no encontrada' });

  const enUso = db.prepare('SELECT COUNT(*) AS n FROM productos WHERE familia_id = ? AND activo = 1').get(id).n;
  if (enUso > 0) {
    return res.status(409).json({ error: `No se puede eliminar: ${enUso} producto(s) activo(s) usan esta familia` });
  }
  db.prepare('DELETE FROM familias WHERE id = ?').run(id);
  res.status(204).end();
});

module.exports = router;
