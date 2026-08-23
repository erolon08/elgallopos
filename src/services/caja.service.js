const db = require('../db');

// La caja es una sola para todo el negocio, no una por terminal/rol: no
// importa si es ADMIN, CAJA u otro el que abrió el turno, solo puede haber
// un turno abierto a la vez y todos lo comparten. "terminal" se sigue
// guardando en cada turno solo como dato informativo (quién/desde dónde se
// abrió), nunca para buscar "el turno de esta terminal" por separado.
function turnoAbierto() {
  return db.prepare("SELECT * FROM caja_turnos WHERE estado = 'abierto' LIMIT 1").get();
}

// Si no hay turno abierto y una acción de fondo (pagar una rendición, un
// gasto rápido del Dashboard) necesita uno, se crea acá sin que el usuario
// pase por "Abrir turno" a propósito — por eso el fondo inicial tiene que
// heredar lo que quedó pactado como fondo del próximo turno en el último
// cierre (fondoSugerido), igual que si lo abriera a mano. Si se dejara en 0
// (como antes), ese turno silencioso queda con un fondo que no refleja la
// plata real que hay en la caja.
function turnoAbiertoOCrear(terminal) {
  let turno = turnoAbierto();
  if (!turno) {
    const info = db
      .prepare("INSERT INTO caja_turnos (numero, terminal, fondo_inicial) VALUES (?, ?, ?)")
      .run('T-' + Date.now(), terminal, fondoSugerido());
    turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(info.lastInsertRowid);
  }
  return turno;
}

function abrirTurno({ terminal, usuario_id, fondo_inicial }) {
  if (!terminal) throw new Error('Falta terminal');
  if (turnoAbierto()) throw new Error('Ya hay un turno de caja abierto');
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

  // Desglose aparte de lo cobrado de cuenta corriente (clientes saldando
  // deuda vieja) por forma de pago — para que el cierre lo muestre separado
  // de lo vendido en el día, aunque ambos sumen al mismo total de caja.
  const ctaCteCobrada = {};
  movimientos
    .filter((m) => m.categoria === 'cuenta_corriente' && m.tipo === 'ingreso')
    .forEach((m) => {
      const fp = m.forma_pago || 'Otro';
      ctaCteCobrada[fp] = (ctaCteCobrada[fp] || 0) + m.monto;
    });
  const totalCtaCteCobrada = Object.values(ctaCteCobrada).reduce((a, v) => a + v, 0);

  return { totalIngresos, totalEgresos, porFormaPago, efectivoEsperado, ctaCteCobrada, totalCtaCteCobrada };
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

function agregarMovimiento(turno_id, { tipo, categoria, concepto, monto, forma_pago, usuario_id, tipo_egreso, fecha }) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(turno_id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  if (!['ingreso', 'egreso'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
  if (!(Number(monto) > 0)) throw new Error('El monto debe ser mayor a 0');
  if (fecha) {
    db.prepare(
      `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, tipo_egreso, concepto, monto, forma_pago, usuario_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(turno_id, tipo, categoria || 'otro', tipo_egreso || null, concepto || null, Number(monto), forma_pago || 'Efectivo', usuario_id || null, `${fecha} 12:00:00`);
  } else {
    db.prepare(
      `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, tipo_egreso, concepto, monto, forma_pago, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(turno_id, tipo, categoria || 'otro', tipo_egreso || null, concepto || null, Number(monto), forma_pago || 'Efectivo', usuario_id || null);
  }
  return obtener(turno_id);
}

// Alta rápida de un gasto desde el Dashboard, sin pasar por la pantalla de
// Caja: usa (o abre) el turno de la terminal y guarda un egreso categoría
// 'gasto', con la subcategoría libre "tipo_egreso" para los reportes.
function agregarGastoRapido({ terminal, usuario_id, fecha, tipo_egreso, detalle, monto, forma_pago }) {
  const turno = turnoAbiertoOCrear(terminal || 'ADMIN');
  return agregarMovimiento(turno.id, {
    tipo: 'egreso',
    categoria: 'gasto',
    tipo_egreso: tipo_egreso || null,
    concepto: detalle || null,
    monto,
    forma_pago: forma_pago || 'Efectivo',
    usuario_id,
    fecha,
  });
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

function editarMovimiento(turno_id, movimiento_id, { tipo, categoria, concepto, monto, forma_pago, tipo_egreso }) {
  requerirMovimientoEditable(turno_id, movimiento_id);
  if (!['ingreso', 'egreso'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
  if (!(Number(monto) > 0)) throw new Error('El monto debe ser mayor a 0');
  db.prepare(
    `UPDATE caja_movimientos SET tipo = ?, categoria = ?, tipo_egreso = ?, concepto = ?, monto = ?, forma_pago = ? WHERE id = ?`
  ).run(tipo, categoria || 'otro', tipo_egreso || null, concepto || null, Number(monto), forma_pago || 'Efectivo', movimiento_id);
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

// Al cerrar, se abre solo el turno siguiente con el fondo que se dejó
// pactado (fondo_turno_siguiente) — la caja queda siempre abierta, sin el
// paso manual de "Abrir turno" entre un cierre y el próximo. Se devuelve el
// turno recién CERRADO (para el ticket de cierre); el nuevo abierto lo toma
// solo la pantalla de Caja en su próxima consulta.
const cerrarTurno = db.transaction((id, datos = {}) => {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('El turno ya está cerrado');
  aplicarCierre(turno, datos);
  db.prepare(`UPDATE caja_turnos SET estado = 'cerrado', cerrado_en = datetime('now','localtime') WHERE id = ?`).run(id);
  const cerrado = obtener(id);
  db.prepare('INSERT INTO caja_turnos (numero, terminal, fondo_inicial) VALUES (?, ?, ?)').run(
    'T-' + Date.now(),
    cerrado.terminal,
    cerrado.fondo_turno_siguiente || 0
  );
  return cerrado;
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

// Desvincula lo que quedó ligado a los movimientos de un turno (ventas y
// rendiciones) antes de borrarlos — común a borrarCierre y vaciarMovimientos.
function desvincularMovimientosDe(turno_id) {
  db.prepare('UPDATE ventas SET caja_turno_id = NULL WHERE caja_turno_id = ?').run(turno_id);
  db.prepare(
    `UPDATE rendiciones SET caja_movimiento_id = NULL
     WHERE caja_movimiento_id IN (SELECT id FROM caja_movimientos WHERE caja_turno_id = ?)`
  ).run(turno_id);
}

// Borra un cierre ya hecho y sus movimientos, para vaciar el historial (ej.
// arrancar de cero después de pruebas). Ventas y rendiciones que quedaron
// ligadas a este turno se DESVINCULAN en vez de borrarse — el cierre es
// historial de caja, no el hecho real de la venta/rendición, que sigue
// existiendo igual.
function borrarCierre(id) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'cerrado') throw new Error('Solo se puede borrar un cierre ya hecho');
  const tx = db.transaction(() => {
    desvincularMovimientosDe(id);
    db.prepare('DELETE FROM caja_movimientos WHERE caja_turno_id = ?').run(id);
    db.prepare('DELETE FROM caja_turnos WHERE id = ?').run(id);
  });
  tx();
}

// Vacía TODOS los movimientos del turno ABIERTO actual (sin importar de
// dónde vinieron: ventas, cuenta corriente, gastos, rendiciones...), para
// arrancar de cero sin tener que cerrar/abrir turno. El turno en sí sigue
// abierto, con el mismo número y fondo inicial — solo pierde su historial
// de movimientos, quedando el efectivo esperado en el fondo inicial.
function vaciarMovimientos(id) {
  const turno = db.prepare('SELECT * FROM caja_turnos WHERE id = ?').get(id);
  if (!turno) throw new Error('Turno no encontrado');
  if (turno.estado !== 'abierto') throw new Error('Solo se puede vaciar el turno que está abierto');
  const tx = db.transaction(() => {
    desvincularMovimientosDe(id);
    db.prepare('DELETE FROM caja_movimientos WHERE caja_turno_id = ?').run(id);
  });
  tx();
  return obtener(id);
}

function fondoSugerido() {
  const ultimo = db
    .prepare("SELECT fondo_turno_siguiente FROM caja_turnos WHERE estado = 'cerrado' ORDER BY cerrado_en DESC LIMIT 1")
    .get();
  return ultimo && ultimo.fondo_turno_siguiente != null ? ultimo.fondo_turno_siguiente : 0;
}

module.exports = {
  turnoAbierto,
  turnoAbiertoOCrear,
  abrirTurno,
  obtener,
  listar,
  agregarMovimiento,
  agregarGastoRapido,
  editarMovimiento,
  quitarMovimiento,
  cerrarTurno,
  editarCierre,
  borrarCierre,
  vaciarMovimientos,
  fondoSugerido,
};
