const db = require('../db');

const TIPOS_MOVIMIENTO = ['venta', 'nota_credito', 'ajuste', 'compra'];

function estadoStock(producto) {
  if (producto.stock_actual <= 0) return 'sin_stock';
  if (producto.stock_actual < producto.stock_minimo) return 'reponer';
  return 'correcto';
}

function listarStock({ q, familia_id, soloBajoMinimo } = {}) {
  let sql = `
    SELECT p.id, p.codigo, p.descripcion, p.stock_actual, p.stock_minimo,
           f.id AS familia_id, f.nombre AS familia
    FROM productos p
    JOIN familias f ON f.id = p.familia_id
    WHERE p.activo = 1 AND f.usa_mano_obra = 0
  `;
  const params = {};
  if (q) {
    sql += ' AND (p.codigo LIKE @q OR p.descripcion LIKE @q)';
    params.q = `%${q}%`;
  }
  if (familia_id) {
    sql += ' AND p.familia_id = @familia_id';
    params.familia_id = familia_id;
  }
  sql += ' ORDER BY p.descripcion';

  const rows = db.prepare(sql).all(params);
  const withEstado = rows.map((r) => ({ ...r, estado: estadoStock(r) }));
  return soloBajoMinimo ? withEstado.filter((r) => r.estado !== 'correcto') : withEstado;
}

function movimientos(producto_id, limit = 50) {
  return db
    .prepare(
      `SELECT * FROM stock_movimientos WHERE producto_id = ? ORDER BY creado_en DESC, id DESC LIMIT ?`
    )
    .all(producto_id, limit);
}

// Movimiento de stock atómico: aplica la cantidad (positiva o negativa) al
// producto y deja registro en stock_movimientos. Usado por ajustes manuales,
// ventas, notas de crédito y compras.
const registrarMovimiento = db.transaction((params) => {
  const { producto_id, tipo, cantidad, motivo, referencia_tipo, referencia_id, usuario_id, terminal } = params;

  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    throw new Error(`Tipo de movimiento inválido: ${tipo}`);
  }
  if (!cantidad || cantidad === 0) {
    throw new Error('La cantidad del movimiento no puede ser 0');
  }

  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
  if (!producto) throw new Error('Producto no encontrado');

  const stockResultante = producto.stock_actual + cantidad;

  db.prepare(
    'UPDATE productos SET stock_actual = ?, actualizado_en = datetime(\'now\') WHERE id = ?'
  ).run(stockResultante, producto_id);

  const info = db
    .prepare(
      `INSERT INTO stock_movimientos
        (producto_id, tipo, cantidad, stock_resultante, motivo, referencia_tipo, referencia_id, usuario_id, terminal)
       VALUES (@producto_id, @tipo, @cantidad, @stock_resultante, @motivo, @referencia_tipo, @referencia_id, @usuario_id, @terminal)`
    )
    .run({
      producto_id,
      tipo,
      cantidad,
      stock_resultante: stockResultante,
      motivo: motivo || null,
      referencia_tipo: referencia_tipo || null,
      referencia_id: referencia_id || null,
      usuario_id: usuario_id || null,
      terminal: terminal || null,
    });

  const productoActualizado = db.prepare('SELECT * FROM productos WHERE id = ?').get(producto_id);
  return {
    movimiento_id: info.lastInsertRowid,
    producto: { ...productoActualizado, estado: estadoStock(productoActualizado) },
  };
});

module.exports = { listarStock, movimientos, registrarMovimiento, estadoStock };
