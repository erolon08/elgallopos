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
  sql += " ORDER BY fecha, CASE turno WHEN 'manana' THEN 0 ELSE 1 END, hora IS NULL, hora, id";
  return db.prepare(sql).all(params);
}

const HORAS_POR_TURNO = { manana: [8, 9, 10, 11, 12], tarde: [16, 17, 18, 19, 20] };

function crear({ direccion, trabajo, telefono, fecha, turno, hora }) {
  if (!direccion || !trabajo || !fecha) throw new Error('Faltan datos (dirección, trabajo y fecha son obligatorios)');
  if (!['manana', 'tarde'].includes(turno)) throw new Error('El turno debe ser mañana o tarde');
  let horaNum = null;
  if (hora !== undefined && hora !== null && hora !== '') {
    horaNum = Number(hora);
    if (!HORAS_POR_TURNO[turno].includes(horaNum)) {
      throw new Error(`La hora tiene que ser una de estas para el turno ${turno === 'manana' ? 'mañana' : 'tarde'}: ${HORAS_POR_TURNO[turno].join(', ')}`);
    }
  }
  const info = db
    .prepare('INSERT INTO agenda_trabajos (direccion, trabajo, telefono, fecha, turno, hora) VALUES (?, ?, ?, ?, ?, ?)')
    .run(direccion.trim(), trabajo.trim(), telefono ? telefono.trim() : null, fecha, turno, horaNum);
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
