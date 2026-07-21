const db = require('../db');

function turnoAbiertoDe(terminal) {
  return db.prepare("SELECT * FROM caja_turnos WHERE terminal = ? AND estado = 'abierto'").get(terminal);
}

function turnoAbiertoOCrear(terminal) {
  let turno = turnoAbiertoDe(terminal);
  if (!turno) {
    const info = db
      .prepare("INSERT INTO caja_turnos (numero, terminal, fondo_inicial) VALUES (?, ?, 0)")
      .run('T-' + Date.now(), terminal);
    turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(info.lastInsertRowid);
  }
  return turno;
}

function abrirTurno({ terminal, usuario_id, fondo_inicial }) {
  if (!terminal) throw new Error('Falta terminal');
  if (turnoAbiertoDe(terminal)) throw new Error('Ya hay un turno abierto en esta terminal');
  const info = db
    .prepare('INSERT INTO caja_turnos (numero, terminal, usuario_id, fondo_inicial) VALUES (?, ?, ?, ?)')
    .run('T-' + Date.now(), terminal, usuario_id || null, Number(fondo_inicial) || 0);
  return obtener(info.lastInsertRowid);
}

function resumenDe(turno, movimientos) {
  const porFormaPago = {};
  movimientos.forEach((m) => {
    const fp = m.forma_pago || 'Otro';
    if (!porFormaPago[fp]) porFormaPago[fp] = { ingresos: 0, egresos: 0 };
    porFormaPago[fp][m.tipo === 'ingreso' ? 'ingresos' : 'egresos'] += m.monto;
  });
  const ingresosEfectivo = (porFormaPago['Efectivo'] || {}).ingresos || 0;
  const egresosEfectivo = (porFormaPago['Efectivo'] || {}).egresos || 0;
  const totalIngresos = movimientos.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + m.monto, 0);
  const totalEgresos = movimientos.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + m.monto, 0);
  const efectivoEsperado = turno.fondo_inicial + ingresosEfectivo - egresosEfectivo;
  return { totalIngresos, totalEgresos, porFormaPago, efectivoEsperado };
}

function obtener(id) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) return null;
  const movimientos = db.prepare('SELECT * FROM caja_movimientos WHERE caja_turno_id = ? ORDER BY id').all(id);
  return { ...turno, movimientos, resumen: resumenDe(turno, movimientos) };
}

function listar({ terminal, estado } = {}) {
  let sql = 'SELECT * FROM caja_turnos WHERE 1 = 1';
  const params = {};
  if (terminal) {
    sql += ' AND terminal = @terminal';
    params.terminal = terminal;
  }
  if (estado) {
    sql += ' AND estado = @estado';
    params.estado = estado;
  }
  sql += ' ORDER BY id DESC LIMIT 100';
  return db.prepare(sql).all(params);
}

function agregarMovimiento(turno_id, { tipo, categoria, concepto, monto, forma_pago, usuario_id }) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(turno_id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  if (!['ingreso', 'egreso'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
  if (!(Number(monto) > 0)) throw new Error('El monto debe ser mayor a 0');
  db.prepare(
    `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(turno_id, tipo, categoria || 'otro', concepto || null, Number(monto), forma_pago || 'Efectivo', usuario_id || null);
  return obtener(turno_id);
}

function cerrarTurno(id, { efectivo_contado, observacion } = {}) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  const movimientos = db.prepare('SELECT * FROM caja_movimientos WHERE caja_turno_id = ?').all(id);
  const { efectivoEsperado } = resumenDe(turno, movimientos);
  const contado = Number(efectivo_contado) || 0;
  db.prepare(
    `UPDATE caja_turnos SET estado = 'cerrado', efectivo_esperado = ?, efectivo_contado = ?, diferencia = ?, observacion = ?, cerrado_en = datetime('now') WHERE id = ?`
  ).run(efectivoEsperado, contado, contado - efectivoEsperado, observacion || null, id);
  return obtener(id);
}

module.exports = { turnoAbiertoDe, turnoAbiertoOCrear, abrirTurno, obtener, listar, agregarMovimiento, cerrarTurno };
