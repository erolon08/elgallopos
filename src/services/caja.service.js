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

// Al cerrar: el efectivo contado se reparte entre lo que se deja como fondo
// del próximo turno (fondo_turno_siguiente) y lo que se manda a caja fuerte
// (el resto), que queda registrado como un egreso más de este turno.
const cerrarTurno = db.transaction((id, { efectivo_contado, fondo_turno_siguiente, observacion } = {}) => {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  const movimientos = db.prepare('SELECT * FROM caja_movimientos WHERE caja_turno_id = ?').all(id);
  const { efectivoEsperado } = resumenDe(turno, movimientos);
  const contado = Number(efectivo_contado) || 0;
  const fondoSiguiente = Number(fondo_turno_siguiente) || 0;
  if (fondoSiguiente > contado) throw new Error('El fondo para el próximo turno no puede ser mayor al efectivo contado');
  const montoCajaFuerte = contado - fondoSiguiente;

  if (montoCajaFuerte > 0) {
    db.prepare(
      `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id)
       VALUES (?, 'egreso', 'caja_fuerte', 'Envío a caja fuerte (cierre de turno)', ?, 'Efectivo', 'caja_turno', ?)`
    ).run(id, montoCajaFuerte, id);
  }

  db.prepare(
    `UPDATE caja_turnos SET estado = 'cerrado', efectivo_esperado = ?, efectivo_contado = ?, diferencia = ?, fondo_turno_siguiente = ?, observacion = ?, cerrado_en = datetime('now','localtime') WHERE id = ?`
  ).run(efectivoEsperado, contado, contado - efectivoEsperado, fondoSiguiente, observacion || null, id);
  return obtener(id);
});

function fondoSugerido(terminal) {
  const ultimo = db
    .prepare("SELECT fondo_turno_siguiente FROM caja_turnos WHERE terminal = ? AND estado = 'cerrado' ORDER BY cerrado_en DESC LIMIT 1")
    .get(terminal);
  return ultimo && ultimo.fondo_turno_siguiente != null ? ultimo.fondo_turno_siguiente : 0;
}

module.exports = { turnoAbiertoDe, turnoAbiertoOCrear, abrirTurno, obtener, listar, agregarMovimiento, cerrarTurno, fondoSugerido };
