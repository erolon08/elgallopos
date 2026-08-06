const db = require('../db');

// Orden de borrado pensado para no romper las foreign keys (primero las
// tablas "hijas" que apuntan a otra, después la tabla apuntada). Deja
// intactos productos, clientes, familias, proveedores, cerrajeros, usuarios
// y configuración — el reset es solo de la operatoria (ventas, presupuestos,
// rendiciones, cajas) y del historial de stock (stock_movimientos), no del
// stock actual de cada producto ni del catálogo.
const TABLAS_RESET = [
  'rendicion_descuentos',
  'rendicion_detalle',
  'mp_pagos',
  'venta_pagos',
  'rendiciones',
  'venta_items',
  'presupuesto_items',
  'presupuestos',
  'ventas',
  'caja_movimientos',
  'caja_turnos',
  'stock_movimientos',
];

const resetearSistema = db.transaction(() => {
  TABLAS_RESET.forEach((tabla) => {
    db.prepare(`DELETE FROM ${tabla}`).run();
  });
  // Reinicia también el contador interno de autoincremento de esas tablas,
  // para que los próximos números (Venta N°, Presupuesto N°, etc.) arranquen
  // de nuevo desde el principio en vez de seguir donde habían quedado.
  const placeholders = TABLAS_RESET.map(() => '?').join(',');
  db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...TABLAS_RESET);
});

module.exports = { resetearSistema };
