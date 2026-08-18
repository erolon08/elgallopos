const db = require('../db');

// Anotador de "adónde va cada cerrajero" antes de facturar. No tiene
// precio ni productos todavía — eso se completa recién al "pasar a venta".

// venta_estado viene de la venta ya creada a partir de esta dirección (si
// la hay): permite distinguir en la lista entre "convertida pero todavía
// sin cobrar" y "ya facturada" (venta_estado = 'cobrada').
const SELECT_CON_CERRAJERO = `
  SELECT d.*, c.nombre AS cerrajero_nombre, v.estado AS venta_estado
  FROM direcciones d
  LEFT JOIN cerrajeros c ON c.id = d.cerrajero_id
  LEFT JOIN ventas v ON v.id = d.venta_id
`;

function listar(estado) {
  if (estado) {
    return db.prepare(`${SELECT_CON_CERRAJERO} WHERE d.estado = ? ORDER BY d.id DESC`).all(estado);
  }
  return db.prepare(`${SELECT_CON_CERRAJERO} ORDER BY d.id DESC`).all();
}

// Para ubicar una dirección ante un reclamo ("¿quién fue y qué se hizo?"),
// sin importar en qué estado esté (pendiente, ya convertida o facturada) ni
// hace cuánto se cargó — por eso ignora el filtro de estado.
function buscar(q) {
  const like = `%${q}%`;
  return db
    .prepare(`${SELECT_CON_CERRAJERO} WHERE d.direccion LIKE ? OR d.telefono LIKE ? OR d.trabajo LIKE ? ORDER BY d.id DESC LIMIT 200`)
    .all(like, like, like);
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

module.exports = { listar, buscar, obtener, crear, eliminar };
