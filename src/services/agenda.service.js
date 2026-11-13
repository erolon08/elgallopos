const db = require('../db');

function listar({ fecha, estado } = {}) {
  let sql = 'SELECT * FROM agenda_trabajos WHERE 1 = 1';
  const params = {};
  if (fecha) {
    sql += ' AND fecha = @fecha';
    params.fecha = fecha;
  }
  if (estado) {
    sql += ' AND estado = @estado';
    params.estado = estado;
  }
  sql += " ORDER BY fecha, CASE turno WHEN 'manana' THEN 0 ELSE 1 END, hora IS NULL, hora, minuto, id";
  return db.prepare(sql).all(params);
}

// Franjas de cada turno en minutos desde las 00:00, elegibles cada 15 min:
// mañana 8:00 a 12:30, tarde 16:00 a 20:30.
const FRANJA_POR_TURNO = { manana: [8 * 60, 12 * 60 + 30], tarde: [16 * 60, 20 * 60 + 30] };

// Acepta "16:15" (lo que manda la pantalla nueva) o un número de hora
// suelto como 16 (formato viejo = 16:00). Devuelve { hora, minuto } o null.
function parsearHora(hora, turno) {
  if (hora === undefined || hora === null || hora === '') return null;
  const m = String(hora).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  const h = m ? Number(m[1]) : NaN;
  const min = m && m[2] ? Number(m[2]) : 0;
  const total = h * 60 + min;
  const [desde, hasta] = FRANJA_POR_TURNO[turno];
  if (!m || min % 15 !== 0 || min > 45 || total < desde || total > hasta) {
    const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    throw new Error(`La hora tiene que ser cada 15 minutos entre ${fmt(desde)} y ${fmt(hasta)} para el turno ${turno === 'manana' ? 'mañana' : 'tarde'}`);
  }
  return { hora: h, minuto: min };
}

function crear({ direccion, trabajo, telefono, fecha, turno, hora }) {
  if (!direccion || !trabajo || !fecha) throw new Error('Faltan datos (dirección, trabajo y fecha son obligatorios)');
  if (!['manana', 'tarde'].includes(turno)) throw new Error('El turno debe ser mañana o tarde');
  const h = parsearHora(hora, turno);
  const info = db
    .prepare('INSERT INTO agenda_trabajos (direccion, trabajo, telefono, fecha, turno, hora, minuto) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(direccion.trim(), trabajo.trim(), telefono ? telefono.trim() : null, fecha, turno, h ? h.hora : null, h ? h.minuto : 0);
  return db.prepare('SELECT * FROM agenda_trabajos WHERE id = ?').get(info.lastInsertRowid);
}

function marcarHecho(id) {
  const info = db.prepare("UPDATE agenda_trabajos SET estado = 'hecho' WHERE id = ?").run(id);
  if (info.changes === 0) throw new Error('No encontrado');
  return db.prepare('SELECT * FROM agenda_trabajos WHERE id = ?').get(id);
}

function eliminar(id) {
  const info = db.prepare('DELETE FROM agenda_trabajos WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error('No encontrado');
}

module.exports = { listar, crear, marcarHecho, eliminar };
