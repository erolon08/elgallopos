// Lista corta de trabajos de "codificados" (autos) con precio fijo, para
// agregar rápido a una rendición sin tipear todo a mano — ver comentario
// en schema.sql sobre la tabla trabajos_codificados.
const db = require('../db');

function listar({ soloActivos } = {}) {
  const sql = soloActivos
    ? 'SELECT * FROM trabajos_codificados WHERE activo = 1 ORDER BY nombre'
    : 'SELECT * FROM trabajos_codificados ORDER BY nombre';
  return db.prepare(sql).all();
}

function crear({ nombre, precio }) {
  if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del trabajo');
  const info = db
    .prepare('INSERT INTO trabajos_codificados (nombre, precio) VALUES (?, ?)')
    .run(nombre.trim(), Number(precio) || 0);
  return db.prepare('SELECT * FROM trabajos_codificados WHERE id = ?').get(info.lastInsertRowid);
}

function actualizar(id, { nombre, precio, activo }) {
  const actual = db.prepare('SELECT * FROM trabajos_codificados WHERE id = ?').get(id);
  if (!actual) return null;
  db.prepare('UPDATE trabajos_codificados SET nombre = ?, precio = ?, activo = ? WHERE id = ?').run(
    nombre !== undefined && nombre.trim() ? nombre.trim() : actual.nombre,
    precio !== undefined ? Number(precio) || 0 : actual.precio,
    activo !== undefined ? (activo ? 1 : 0) : actual.activo,
    id
  );
  return db.prepare('SELECT * FROM trabajos_codificados WHERE id = ?').get(id);
}

function eliminar(id) {
  const info = db.prepare('DELETE FROM trabajos_codificados WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = { listar, crear, actualizar, eliminar };
