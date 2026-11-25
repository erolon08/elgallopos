const db = require('../db');

// Agenda de direcciones: adónde va cada cerrajero, qué día y en qué turno
// (con hora puntual opcional). No tiene precio ni productos todavía — eso
// se completa recién al "pasar a venta". También se puede marcar "hecha"
// sin facturar.

// venta_estado viene de la venta ya creada a partir de esta dirección (si
// la hay): permite distinguir en la lista entre "convertida pero todavía
// sin cobrar" y "ya facturada" (venta_estado = 'cobrada').
const SELECT_CON_CERRAJERO = `
  SELECT d.*, c.nombre AS cerrajero_nombre, v.estado AS venta_estado
  FROM direcciones d
  LEFT JOIN cerrajeros c ON c.id = d.cerrajero_id
  LEFT JOIN ventas v ON v.id = d.venta_id
`;

const ORDEN_PROXIMAS = "ORDER BY d.fecha, CASE d.turno WHEN 'manana' THEN 0 ELSE 1 END, d.horario IS NULL, d.horario, d.id";

// Pendientes: de la más próxima a la más lejana. Historial: de la más nueva
// a la más vieja.
function listar({ estado, fecha } = {}) {
  let sql = `${SELECT_CON_CERRAJERO} WHERE 1 = 1`;
  const params = {};
  if (estado === 'historial') {
    sql += " AND d.estado != 'pendiente'";
  } else if (estado) {
    sql += ' AND d.estado = @estado';
    params.estado = estado;
  }
  if (fecha) {
    sql += ' AND d.fecha = @fecha';
    params.fecha = fecha;
  }
  sql += estado === 'pendiente' ? ` ${ORDEN_PROXIMAS}` : ' ORDER BY d.fecha DESC, d.id DESC';
  return db.prepare(sql).all(params);
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

// Franja de cada turno en minutos desde las 00:00: mañana 8:00 a 12:30,
// tarde 16:00 a 20:30. El horario se elige cada 15 minutos dentro de ella.
const FRANJA_POR_TURNO = { manana: [8 * 60, 12 * 60 + 30], tarde: [16 * 60, 20 * 60 + 30] };

function normalizarHorario(horario) {
  if (horario === undefined || horario === null || String(horario).trim() === '') return null;
  const m = String(horario).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) % 15 !== 0 || Number(m[2]) > 45) {
    throw new Error('El horario tiene que ser cada 15 minutos (ej. 16:00, 16:15, 16:30, 16:45)');
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

const minutosDe = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Turno que corresponde a un horario, o a la hora actual si no hay horario.
function turnoPara(horario) {
  const ref = horario ? minutosDe(horario) : new Date().getHours() * 60 + new Date().getMinutes();
  return ref < 14 * 60 ? 'manana' : 'tarde';
}

function fechaHoy() {
  return db.prepare("SELECT date('now','localtime') AS hoy").get().hoy;
}

function crear(datos) {
  const direccion = String(datos.direccion || '').trim();
  const trabajo = String(datos.trabajo || '').trim();
  if (!direccion) throw new Error('Falta la dirección');
  if (!trabajo) throw new Error('Falta el trabajo a realizar');
  const horario = normalizarHorario(datos.horario);
  // Con horario, el turno sale del horario; sin horario, el que se eligió
  // (o el de este momento, ej. una dirección que carga el bot de WhatsApp).
  let turno = ['manana', 'tarde'].includes(datos.turno) ? datos.turno : turnoPara(null);
  if (horario) {
    turno = turnoPara(horario);
    const [desde, hasta] = FRANJA_POR_TURNO[turno];
    const t = minutosDe(horario);
    if (t < desde || t > hasta) throw new Error('El horario tiene que estar entre 8:00 y 12:30 (mañana) o entre 16:00 y 20:30 (tarde)');
  }
  const fecha = datos.fecha ? String(datos.fecha) : fechaHoy();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida');
  const info = db
    .prepare('INSERT INTO direcciones (direccion, trabajo, telefono, cerrajero_id, fecha, turno, horario) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(direccion, trabajo, datos.telefono || null, datos.cerrajero_id || null, fecha, turno, horario);
  return obtener(info.lastInsertRowid);
}

// Trabajo hecho sin pasarlo a venta (ej. una visita sin cargo).
function marcarHecha(id) {
  const info = db
    .prepare("UPDATE direcciones SET estado = 'hecha', hecha_en = datetime('now','localtime') WHERE id = ? AND estado = 'pendiente'")
    .run(id);
  if (info.changes === 0) throw new Error('La dirección no está pendiente');
  return obtener(id);
}

function eliminar(id) {
  const info = db.prepare('DELETE FROM direcciones WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = { listar, buscar, obtener, crear, marcarHecha, eliminar };
