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

// Solo se pueden editar/quitar movimientos cargados a mano (retiro, gasto,
// empleados, otro): los que vienen de una venta, una rendición o el envío a
// caja fuerte del cierre (referencia_tipo NOT NULL) reflejan un hecho real
// y no se tocan desde acá.
function requerirMovimientoEditable(turno_id, movimiento_id) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(turno_id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  const mov = db.prepare('SELECT * FROM caja_movimientos WHERE id = ? AND caja_turno_id = ?').get(movimiento_id, turno_id);
  if (!mov) throw new Error('Movimiento no encontrado');
  if (mov.referencia_tipo) throw new Error('Este movimiento no se puede editar');
  return mov;
}

function editarMovimiento(turno_id, movimiento_id, { tipo, categoria, concepto, monto, forma_pago }) {
  requerirMovimientoEditable(turno_id, movimiento_id);
  if (!['ingreso', 'egreso'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
  if (!(Number(monto) > 0)) throw new Error('El monto debe ser mayor a 0');
  db.prepare(
    `UPDATE caja_movimientos SET tipo = ?, categoria = ?, concepto = ?, monto = ?, forma_pago = ? WHERE id = ?`
  ).run(tipo, categoria || 'otro', concepto || null, Number(monto), forma_pago || 'Efectivo', movimiento_id);
  return obtener(turno_id);
}

function quitarMovimiento(turno_id, movimiento_id) {
  requerirMovimientoEditable(turno_id, movimiento_id);
  db.prepare('DELETE FROM caja_movimientos WHERE id = ?').run(movimiento_id);
  return obtener(turno_id);
}

// Recalcula el arqueo de un turno (usado tanto al cerrar como al corregir un
// cierre ya hecho): el efectivo contado se reparte entre lo que se deja como
// fondo del próximo turno (fondo_turno_siguiente) y lo que se manda a caja
// fuerte (el resto), que queda registrado como un egreso más de este turno.
// Antes de recalcular se borra el envío a caja fuerte anterior (si existía)
// para no arrastrar un monto viejo cuando se corrige el cierre.
function aplicarCierre(turno, { efectivo_contado, fondo_turno_siguiente, observacion }) {
  db.prepare(
    "DELETE FROM caja_movimientos WHERE caja_turno_id = ? AND categoria = 'caja_fuerte' AND referencia_tipo = 'caja_turno' AND referencia_id = ?"
  ).run(turno.id, turno.id);
  const movimientos = db.prepare('SELECT * FROM caja_movimientos WHERE caja_turno_id = ?').all(turno.id);
  const { efectivoEsperado } = resumenDe(turno, movimientos);
  const contado = Number(efectivo_contado) || 0;
  const fondoSiguiente = Number(fondo_turno_siguiente) || 0;
  if (fondoSiguiente > contado) throw new Error('El fondo para el próximo turno no puede ser mayor al efectivo contado');
  const montoCajaFuerte = contado - fondoSiguiente;

  if (montoCajaFuerte > 0) {
    db.prepare(
      `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id)
       VALUES (?, 'egreso', 'caja_fuerte', 'Envío a caja fuerte (cierre de turno)', ?, 'Efectivo', 'caja_turno', ?)`
    ).run(turno.id, montoCajaFuerte, turno.id);
  }

  db.prepare(
    `UPDATE caja_turnos SET efectivo_esperado = ?, efectivo_contado = ?, diferencia = ?, fondo_turno_siguiente = ?, observacion = ? WHERE id = ?`
  ).run(efectivoEsperado, contado, contado - efectivoEsperado, fondoSiguiente, observacion || null, turno.id);
}

const cerrarTurno = db.transaction((id, datos = {}) => {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  aplicarCierre(turno, datos);
  db.prepare(`UPDATE caja_turnos SET estado = 'cerrado', cerrado_en = datetime('now','localtime') WHERE id = ?`).run(id);
  return obtener(id);
});

// Corrige un cierre ya hecho (ej. se contó mal el efectivo o se dejó un
// fondo equivocado) sin reabrir el turno ni tocar la fecha de cierre.
const editarCierre = db.transaction((id, datos = {}) => {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'cerrado') throw new Error('Solo se puede modificar el cierre de un turno ya cerrado');
  aplicarCierre(turno, datos);
  return obtener(id);
});

function fondoSugerido(terminal) {
  const ultimo = db
    .prepare("SELECT fondo_turno_siguiente FROM caja_turnos WHERE terminal = ? AND estado = 'cerrado' ORDER BY cerrado_en DESC LIMIT 1")
    .get(terminal);
  return ultimo && ultimo.fondo_turno_siguiente != null ? ultimo.fondo_turno_siguiente : 0;
}

module.exports = {
  turnoAbiertoDe,
  turnoAbiertoOCrear,
  abrirTurno,
  obtener,
  listar,
  agregarMovimiento,
  editarMovimiento,
  quitarMovimiento,
  cerrarTurno,
  editarCierre,
  fondoSugerido,
};
