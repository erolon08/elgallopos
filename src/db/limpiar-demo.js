// Borra los productos, clientes y todo lo que se haya llegado a cargar de
// prueba con ellos (ventas, presupuestos, vehículos, stock) — pensado para
// dejar la base lista antes de importar los Excel reales de clientes y
// productos. NO toca usuarios/claves, configuración (incluida la de ARCA),
// familias, proveedores ni cerrajeros.
//
// Uso: node src/db/limpiar-demo.js
const db = require('./index');

const tx = db.transaction(() => {
  const totales = {
    productos: db.prepare('SELECT COUNT(*) c FROM productos').get().c,
    clientes: db.prepare('SELECT COUNT(*) c FROM clientes').get().c,
  };

  db.prepare('DELETE FROM stock_movimientos').run();

  db.prepare('DELETE FROM rendicion_detalle').run();
  db.prepare('DELETE FROM rendicion_descuentos').run();
  db.prepare('DELETE FROM rendiciones').run();
  db.prepare("DELETE FROM caja_movimientos WHERE referencia_tipo IN ('venta','rendicion')").run();

  db.prepare('DELETE FROM presupuesto_items').run();
  db.prepare('DELETE FROM presupuestos').run();
  db.prepare('DELETE FROM venta_pagos').run();
  db.prepare('DELETE FROM venta_items').run();
  db.prepare('DELETE FROM ventas').run();

  db.prepare('DELETE FROM vehiculos').run();
  db.prepare('DELETE FROM clientes').run();
  db.prepare('DELETE FROM productos').run();

  return totales;
});

const totales = tx();
console.log('Limpieza de datos de prueba completa.');
console.log(`  Productos borrados: ${totales.productos}`);
console.log(`  Clientes borrados:  ${totales.clientes}`);
console.log('También se borraron ventas, presupuestos, rendiciones, vehículos y movimientos de stock que dependían de ellos.');
console.log('No se tocaron usuarios/claves, configuración (ARCA incluido), familias, proveedores ni cerrajeros.');
