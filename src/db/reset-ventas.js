// Borra ventas, presupuestos y rendiciones (con todo lo que depende de
// ellos) para poder empezar a probar el sistema desde cero. NO toca
// productos, clientes, familias, proveedores, cerrajeros, configuración,
// usuarios/claves, ni las cantidades de stock actuales (stock_actual) —
// solo se borran los movimientos de stock que quedaron generados por las
// ventas eliminadas, porque ya no tienen la venta a la que apuntaban.
//
// Uso: node src/db/reset-ventas.js
const db = require('./index');

const tx = db.transaction(() => {
  const totales = {
    ventas: db.prepare('SELECT COUNT(*) c FROM ventas').get().c,
    presupuestos: db.prepare('SELECT COUNT(*) c FROM presupuestos').get().c,
    rendiciones: db.prepare('SELECT COUNT(*) c FROM rendiciones').get().c,
  };

  // Movimientos de stock generados por ventas (la reposición de stock por
  // anulación también queda cubierta, son movimientos con referencia_tipo='venta').
  db.prepare("DELETE FROM stock_movimientos WHERE referencia_tipo = 'venta'").run();

  // Una rendición pagada queda "enganchada" a su movimiento de caja
  // (rendiciones.caja_movimiento_id), así que hay que borrar la rendición
  // ANTES que ese movimiento de caja, o la foreign key lo rechaza.
  db.prepare('DELETE FROM rendicion_detalle').run();
  db.prepare('DELETE FROM rendicion_descuentos').run();
  db.prepare('DELETE FROM rendiciones').run();

  // Movimientos de caja generados por ventas o pagos de rendición (quedarían
  // "huérfanos" apuntando a una venta/rendición que ya no existe).
  db.prepare("DELETE FROM caja_movimientos WHERE referencia_tipo IN ('venta','rendicion')").run();

  db.prepare('DELETE FROM venta_pagos').run();
  db.prepare('DELETE FROM venta_items').run();
  db.prepare('DELETE FROM ventas').run();

  db.prepare('DELETE FROM presupuesto_items').run();
  db.prepare('DELETE FROM presupuestos').run();

  return totales;
});

const totales = tx();
console.log('Reset de ventas completo.');
console.log(`  Ventas borradas:       ${totales.ventas}`);
console.log(`  Presupuestos borrados: ${totales.presupuestos}`);
console.log(`  Rendiciones borradas:  ${totales.rendiciones}`);
console.log('No se tocaron productos, clientes, stock_actual, caja (turnos), configuración ni usuarios/claves.');
