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

// Horario opcional "HH:MM", cada 15 minutos (ej. 16:00, 16:15, 16:30, 16:45).
function normalizarHorario(horario) {
  if (horario === undefined || horario === null || String(horario).trim() === '') return null;
  const m = String(horario).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) % 15 !== 0 || Number(m[2]) > 45) {
    throw new Error('El horario tiene que ser cada 15 minutos (ej. 16:00, 16:15, 16:30, 16:45)');
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function crear(datos) {
  const direccion = String(datos.direccion || '').trim();
  const trabajo = String(datos.trabajo || '').trim();
  if (!direccion) throw new Error('Falta la dirección');
  if (!trabajo) throw new Error('Falta el trabajo a realizar');
  const horario = normalizarHorario(datos.horario);
  const info = db
    .prepare('INSERT INTO direcciones (direccion, trabajo, telefono, cerrajero_id, horario) VALUES (?, ?, ?, ?, ?)')
    .run(direccion, trabajo, datos.telefono || null, datos.cerrajero_id || null, horario);
  return obtener(info.lastInsertRowid);
}

function eliminar(id) {
  const info = db.prepare('DELETE FROM direcciones WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = { listar, buscar, obtener, crear, eliminar };
