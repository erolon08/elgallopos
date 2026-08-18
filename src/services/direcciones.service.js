const db = require('../db');

// Anotador de "adónde va cada cerrajero" antes de facturar. No tiene
// precio ni productos todavía — eso se completa recién al "pasar a venta".

const SELECT_CON_CERRAJERO = `
  SELECT d.*, c.nombre AS cerrajero_nombre
  FROM direcciones d
  LEFT JOIN cerrajeros c ON c.id = d.cerrajero_id
`;

function listar(estado) {
  if (estado) {
    return db.prepare(`${SELECT_CON_CERRAJERO} WHERE d.estado = ? ORDER BY d.id DESC`).all(estado);
  }
  return db.prepare(`${SELECT_CON_CERRAJERO} ORDER BY d.id DESC`).all();
}

function obtener(id) {
  return db.prepare(`${SELECT_CON_CERRAJERO} WHERE d.id = ?`).get(id);
}

function crear(datos) {
  const direccion = String(datos.direccion || '').trim();
  const trabajo = String(datos.trabajo || '').trim();
  if (!direccion) throw new Error('Falta la dirección');
  if (!trabajo) throw new Error('Falta el trabajo a realizar');
  const info = db
    .prepare('INSERT INTO direcciones (direccion, trabajo, telefono, cerrajero_id) VALUES (?, ?, ?, ?)')
    .run(direccion, trabajo, datos.telefono || null, datos.cerrajero_id || null);
  return obtener(info.lastInsertRowid);
}

function eliminar(id) {
  const info = db.prepare('DELETE FROM direcciones WHERE id = ?').run(id);
  return info.changes > 0;
}

function marcarConvertida(id) {
  const info = db
    .prepare("UPDATE direcciones SET estado = 'convertida', convertido_en = datetime('now','localtime') WHERE id = ? AND estado = 'pendiente'")
    .run(id);
  return info.changes > 0;
}

module.exports = { listar, obtener, crear, eliminar, marcarConvertida };
