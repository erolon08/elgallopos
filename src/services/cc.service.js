const db = require('../db');
const cajaService = require('./caja.service');

const TIPOS_MOVIMIENTO = ['saldo_inicial', 'venta', 'pago', 'ajuste', 'nota_credito'];

// Movimiento de cuenta corriente atómico: aplica el monto (positivo suma
// deuda, negativo la resta) al saldo del cliente y deja registro en
// cc_movimientos — mismo patrón que stockService.registrarMovimiento.
const registrarMovimiento = db.transaction((params) => {
  const { cliente_id, tipo, monto, motivo, forma_pago, referencia_tipo, referencia_id, usuario_id, terminal } = params;

  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    throw new Error(`Tipo de movimiento de cuenta corriente inválido: ${tipo}`);
  }
  if (!monto || monto === 0) {
    throw new Error('El monto del movimiento no puede ser 0');
  }

  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(cliente_id);
  if (!cliente) throw new Error('Cliente no encontrado');

  const saldoResultante = Number(cliente.saldo_cta_cte) + Number(monto);

  db.prepare('UPDATE clientes SET saldo_cta_cte = ? WHERE id = ?').run(saldoResultante, cliente_id);

  const info = db
    .prepare(
      `INSERT INTO cc_movimientos
        (cliente_id, tipo, monto, saldo_resultante, motivo, forma_pago, referencia_tipo, referencia_id, usuario_id, terminal)
       VALUES (@cliente_id, @tipo, @monto, @saldo_resultante, @motivo, @forma_pago, @referencia_tipo, @referencia_id, @usuario_id, @terminal)`
    )
    .run({
      cliente_id,
      tipo,
      monto: Number(monto),
      saldo_resultante: saldoResultante,
      motivo: motivo || null,
      forma_pago: forma_pago || null,
      referencia_tipo: referencia_tipo || null,
      referencia_id: referencia_id || null,
      usuario_id: usuario_id || null,
      terminal: terminal || null,
    });

  return { movimiento_id: info.lastInsertRowid, saldo_resultante: saldoResultante };
});

function movimientos(cliente_id, { desde, hasta } = {}) {
  let sql = `
    SELECT cc.*, u.nombre AS usuario_nombre, v.numero AS venta_numero
    FROM cc_movimientos cc
    LEFT JOIN usuarios u ON u.id = cc.usuario_id
    LEFT JOIN ventas v ON cc.referencia_tipo = 'venta' AND cc.referencia_id = v.id
    WHERE cc.cliente_id = @cliente_id
  `;
  const params = { cliente_id };
  if (desde) {
    sql += ' AND date(cc.creado_en) >= date(@desde)';
    params.desde = desde;
  }
  if (hasta) {
    sql += ' AND date(cc.creado_en) <= date(@hasta)';
    params.hasta = hasta;
  }
  sql += ' ORDER BY cc.creado_en DESC, cc.id DESC LIMIT 500';
  return db.prepare(sql).all(params);
}

// Todas las deudas pendientes de un cliente — ventas reales a Cta. Cte. Y
// facturas migradas de posBerry — unificadas en una sola lista cronológica
// para elegir una factura puntual a cancelar en vez de un pago libre.
function pendientesDeCliente(cliente_id) {
  const deVentas = db
    .prepare(
      `SELECT id, 'venta' AS tipo, numero, total, cta_cte_saldo_pendiente AS saldo_pendiente, creado_en
       FROM ventas
       WHERE cliente_id = ? AND estado = 'cobrada' AND cta_cte_saldo_pendiente > 0`
    )
    .all(cliente_id);
  const migradas = db
    .prepare(
      `SELECT id, 'migrada' AS tipo, numero_factura AS numero, monto_original AS total, saldo_pendiente, creado_en
       FROM cc_deudas_migradas
       WHERE cliente_id = ? AND saldo_pendiente > 0`
    )
    .all(cliente_id);
  return [...deVentas, ...migradas].sort((a, b) => a.creado_en.localeCompare(b.creado_en) || a.id - b.id);
}

// Aplica "aplicado" pesos a una deuda puntual (venta real o factura
// migrada) y devuelve el dato para armar el ticket/historial.
function aplicarAdeuda(deuda, aplicado) {
  const nuevoSaldo = Math.round((deuda.saldo_pendiente - aplicado) * 100) / 100;
  if (deuda.tipo === 'migrada') {
    db.prepare('UPDATE cc_deudas_migradas SET saldo_pendiente = ? WHERE id = ?').run(nuevoSaldo, deuda.id);
  } else {
    db.prepare('UPDATE ventas SET cta_cte_saldo_pendiente = ? WHERE id = ?').run(nuevoSaldo, deuda.id);
  }
  return { deuda_id: deuda.id, numero: deuda.numero, tipo: deuda.tipo, aplicado, saldada: nuevoSaldo <= 0 };
}

// Registra que el cliente pagó (total o parcial) su deuda: resta del saldo y
// genera un ingreso en la caja del turno abierto — entra plata real al
// negocio igual que una venta cobrada, con la forma de pago que sea
// (efectivo, transferencia, cheque, tarjeta, QR...). Lo pagado se aplica de
// dos formas posibles:
//   - deuda_id + deuda_tipo puntual ('venta' o 'migrada'): cancela ESA
//     factura (no puede superar lo que le queda pendiente a ella sola).
//   - sin deuda_id (pago libre): se reparte entre TODAS las deudas
//     pendientes del cliente (ventas y facturas migradas mezcladas) de la
//     más vieja a la más nueva, como se paga una cuenta real.
// En ambos casos se marcan las deudas afectadas como saldadas si llegan a
// $0, para poder pintarlas de rojo/verde en el historial.
const registrarPago = db.transaction(({ cliente_id, monto, forma_pago, motivo, usuario_id, terminal, venta_id, deuda_id, deuda_tipo }) => {
  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) throw new Error('El monto a cobrar tiene que ser mayor a 0');

  // venta_id queda como alias viejo de deuda_id/deuda_tipo='venta' por compatibilidad.
  const deudaIdSel = deuda_id || venta_id || null;
  const deudaTipoSel = deuda_id ? deuda_tipo || 'venta' : venta_id ? 'venta' : null;

  const clienteAntes = db.prepare('SELECT id, nombre, saldo_cta_cte FROM clientes WHERE id = ?').get(cliente_id);
  if (!clienteAntes) throw new Error('Cliente no encontrado');
  const saldoAnterior = Number(clienteAntes.saldo_cta_cte);

  const resultado = registrarMovimiento({
    cliente_id,
    tipo: 'pago',
    monto: -Math.abs(montoNum),
    motivo: motivo || 'Pago de cuenta corriente',
    forma_pago: forma_pago || 'Efectivo',
    usuario_id,
    terminal,
  });

  const ventasAfectadas = [];

  if (deudaIdSel) {
    const deuda = pendientesDeCliente(cliente_id).find(
      (d) => d.tipo === deudaTipoSel && Number(d.id) === Number(deudaIdSel)
    );
    if (!deuda) throw new Error('Esa factura no existe, no es de este cliente, o ya está saldada.');
    if (montoNum > deuda.saldo_pendiente + 0.01) {
      throw new Error(
        `El monto ($${montoNum}) no puede superar el saldo pendiente de la factura N° ${deuda.numero} ($${deuda.saldo_pendiente}). Para pagar más, hacelo como pago libre.`
      );
    }
    ventasAfectadas.push(aplicarAdeuda(deuda, montoNum));
  } else {
    let restante = montoNum;
    const pendientes = pendientesDeCliente(cliente_id);
    for (const d of pendientes) {
      if (restante <= 0) break;
      const aplicado = Math.min(restante, d.saldo_pendiente);
      ventasAfectadas.push(aplicarAdeuda(d, aplicado));
      restante -= aplicado;
    }
  }

  // Queda asentado a qué deuda fue cada peso, para poder deshacer el cobro
  // con exactitud si se cargó mal (ver deshacerPago).
  const insAplicacion = db.prepare(
    'INSERT INTO cc_pago_aplicaciones (cc_movimiento_id, deuda_tipo, deuda_id, monto) VALUES (?, ?, ?, ?)'
  );
  for (const a of ventasAfectadas) insAplicacion.run(resultado.movimiento_id, a.tipo, a.deuda_id, a.aplicado);

  const turno = cajaService.turnoAbiertoOCrear(terminal);
  db.prepare(
    `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, cc_movimiento_id, usuario_id)
     VALUES (?, 'ingreso', 'cuenta_corriente', ?, ?, ?, 'cliente', ?, ?, ?)`
  ).run(
    turno.id,
    `Cobro cuenta corriente — ${clienteAntes.nombre}`,
    montoNum,
    forma_pago || 'Efectivo',
    cliente_id,
    resultado.movimiento_id,
    usuario_id || null
  );

  return {
    ...resultado,
    cliente_nombre: clienteAntes.nombre,
    monto_pagado: montoNum,
    forma_pago: forma_pago || 'Efectivo',
    saldo_anterior: saldoAnterior,
    saldo_nuevo: resultado.saldo_resultante,
    ventas_afectadas: ventasAfectadas,
  };
});

// Base del menú "Cuenta Corriente": los clientes que deben (o tienen a
// favor), y ADEMÁS los que tuvieron movimiento de cuenta corriente en los
// últimos 30 días aunque hayan quedado en $0. Antes un cliente desaparecía
// de esta pantalla apenas se le cobraba todo — y si ese cobro estaba mal
// cargado, ya no había por dónde entrar a su cuenta para deshacerlo.
// Primero los que deben, después los saldados recientes.
function listarDeudas() {
  return db
    .prepare(
      `SELECT c.id, c.codigo, c.nombre, c.telefono, c.saldo_cta_cte,
              (SELECT MAX(m.creado_en) FROM cc_movimientos m WHERE m.cliente_id = c.id) AS ultimo_movimiento
       FROM clientes c
       WHERE c.activo = 1
         AND (c.saldo_cta_cte != 0
              OR EXISTS (SELECT 1 FROM cc_movimientos m
                         WHERE m.cliente_id = c.id AND m.creado_en >= datetime('now','localtime','-30 days')))
       ORDER BY (c.saldo_cta_cte != 0) DESC, c.saldo_cta_cte DESC, ultimo_movimiento DESC`
    )
    .all();
}

// Deshace un cobro cargado mal (ej. se puso Efectivo y en realidad fue por
// Transferencia, con lo que a la caja le "faltaría" plata). Revierte las
// tres cosas que hizo registrarPago, siempre agregando movimientos
// inversos, nunca borrando (mismo criterio que anular una venta):
//   1. vuelve a sumar el monto al saldo del cliente (cc_movimientos 'ajuste');
//   2. vuelve a dejar pendientes las facturas que ese cobro había saldado,
//      exactamente por lo que se les aplicó (cc_pago_aplicaciones);
//   3. mete en la caja del turno abierto un egreso con la misma forma de
//      pago, que cancela el ingreso equivocado.
// Después se vuelve a cargar el cobro con la forma de pago correcta.
// Solo se puede deshacer el ÚLTIMO movimiento del cliente: si después ya
// hubo otra venta o pago, deshacer este dejaría los saldos de esas
// facturas en un estado que no se corresponde con nada real.
const deshacerPago = db.transaction((cliente_id, movimiento_id, { usuario_id, terminal } = {}) => {
  const pago = db.prepare('SELECT * FROM cc_movimientos WHERE id = ? AND cliente_id = ?').get(movimiento_id, cliente_id);
  if (!pago) throw new Error('Cobro no encontrado');
  if (pago.tipo !== 'pago') throw new Error('Solo se puede deshacer un cobro (pago de cuenta corriente)');
  const posterior = db.prepare('SELECT id FROM cc_movimientos WHERE cliente_id = ? AND id > ? LIMIT 1').get(cliente_id, movimiento_id);
  if (posterior) {
    throw new Error('Este cliente ya tiene movimientos posteriores a ese cobro — no se puede deshacer. Si hace falta, corregilo con un ajuste manual de saldo.');
  }

  const cliente = db.prepare('SELECT id, nombre FROM clientes WHERE id = ?').get(cliente_id);
  const monto = Math.abs(Number(pago.monto));

  const resultado = registrarMovimiento({
    cliente_id,
    tipo: 'ajuste',
    monto,
    motivo: `Se deshizo el cobro del ${pago.creado_en.slice(0, 16)} ($${monto}, ${pago.forma_pago || 'Efectivo'})`,
    referencia_tipo: 'cc_movimiento',
    referencia_id: pago.id,
    usuario_id,
    terminal,
  });

  const aplicaciones = db.prepare('SELECT * FROM cc_pago_aplicaciones WHERE cc_movimiento_id = ?').all(pago.id);
  const devolverAdeuda = (tipo, id, cuanto) => {
    if (tipo === 'migrada') {
      db.prepare('UPDATE cc_deudas_migradas SET saldo_pendiente = ROUND(saldo_pendiente + ?, 2) WHERE id = ?').run(cuanto, id);
    } else {
      db.prepare('UPDATE ventas SET cta_cte_saldo_pendiente = ROUND(cta_cte_saldo_pendiente + ?, 2) WHERE id = ?').run(cuanto, id);
    }
  };
  if (aplicaciones.length) {
    for (const a of aplicaciones) devolverAdeuda(a.deuda_tipo, a.deuda_id, a.monto);
  } else {
    // Cobro anterior a que se guardara el detalle de aplicación: como fue el
    // último movimiento del cliente (lo garantiza el chequeo de arriba) y
    // registrarPago aplica de la más vieja a la más nueva, el inverso exacto
    // es devolver de la más nueva a la más vieja hasta agotar el monto.
    let restante = monto;
    const deudas = [
      ...db.prepare("SELECT id, 'venta' AS tipo, total AS original, cta_cte_saldo_pendiente AS pendiente, creado_en FROM ventas WHERE cliente_id = ? AND estado = 'cobrada' AND forma_pago LIKE '%Cuenta Corriente%'").all(cliente_id),
      ...db.prepare("SELECT id, 'migrada' AS tipo, monto_original AS original, saldo_pendiente AS pendiente, creado_en FROM cc_deudas_migradas WHERE cliente_id = ?").all(cliente_id),
    ].sort((a, b) => b.creado_en.localeCompare(a.creado_en) || b.id - a.id);
    for (const d of deudas) {
      if (restante <= 0) break;
      const cabe = Math.max(0, Number(d.original) - Number(d.pendiente));
      const devolver = Math.min(restante, cabe);
      if (devolver > 0) {
        devolverAdeuda(d.tipo, d.id, devolver);
        restante -= devolver;
      }
    }
  }

  const turno = cajaService.turnoAbiertoOCrear(terminal);
  db.prepare(
    `INSERT INTO caja_movimientos (caja_turno_id, tipo, categoria, concepto, monto, forma_pago, referencia_tipo, referencia_id, cc_movimiento_id, usuario_id)
     VALUES (?, 'egreso', 'cuenta_corriente', ?, ?, ?, 'cliente', ?, ?, ?)`
  ).run(turno.id, `Se deshizo cobro cuenta corriente — ${cliente.nombre}`, monto, pago.forma_pago || 'Efectivo', cliente_id, pago.id, usuario_id || null);

  return { cliente_id, monto, forma_pago: pago.forma_pago || 'Efectivo', saldo_nuevo: resultado.saldo_resultante };
});

// Deshacer un cobro parado en la fila de la CAJA (el ingreso "Cobro cuenta
// corriente — Fulano"), que es donde uno se da cuenta de que la forma de
// pago quedó mal. Resuelve a qué cobro corresponde esa fila y delega en
// deshacerPago (mismas reglas). Los ingresos nuevos traen cc_movimiento_id
// directo; los anteriores a esta versión no, así que para esos se busca el
// último movimiento del cliente y se exige que sea un cobro por el mismo
// monto y forma de pago — si no coincide, mejor no adivinar.
function deshacerPagoDesdeCaja(caja_movimiento_id, opts = {}) {
  const mov = db.prepare('SELECT * FROM caja_movimientos WHERE id = ?').get(caja_movimiento_id);
  if (!mov) throw new Error('Movimiento de caja no encontrado');
  if (mov.categoria !== 'cuenta_corriente' || mov.tipo !== 'ingreso' || mov.referencia_tipo !== 'cliente') {
    throw new Error('Ese movimiento no es un cobro de cuenta corriente');
  }
  const cliente_id = mov.referencia_id;
  let pagoId = mov.cc_movimiento_id;
  if (!pagoId) {
    const ultimo = db.prepare('SELECT * FROM cc_movimientos WHERE cliente_id = ? ORDER BY id DESC LIMIT 1').get(cliente_id);
    const coincide =
      ultimo &&
      ultimo.tipo === 'pago' &&
      Math.abs(Math.abs(Number(ultimo.monto)) - Number(mov.monto)) < 0.01 &&
      (ultimo.forma_pago || 'Efectivo') === (mov.forma_pago || 'Efectivo');
    if (!coincide) {
      throw new Error('No se pudo identificar con certeza ese cobro en la cuenta del cliente (ya hubo otros movimientos después). Deshacelo desde la Cuenta Corriente del cliente, o corregilo con un ajuste manual.');
    }
    pagoId = ultimo.id;
  }
  return deshacerPago(cliente_id, pagoId, opts);
}

module.exports = { registrarMovimiento, movimientos, registrarPago, deshacerPago, deshacerPagoDesdeCaja, listarDeudas, pendientesDeCliente };
