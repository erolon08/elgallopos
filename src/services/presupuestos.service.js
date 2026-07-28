const db = require('../db');

function generarNumero() {
  const { max } = db.prepare("SELECT MAX(CAST(SUBSTR(numero, 3) AS INTEGER)) AS max FROM presupuestos").get();
  return 'P-' + String((max || 0) + 1).padStart(4, '0');
}

const crear = db.transaction((datos) => {
  if (!datos.items || !datos.items.length) throw new Error('El presupuesto no tiene productos');
  const total = datos.items.reduce(
    (acc, it) => acc + Number(it.precio_unitario) * Number(it.cantidad || 1) - (Number(it.descuento) || 0),
    0
  );

  const info = db
    .prepare(
      `INSERT INTO presupuestos (numero, cliente_id, vigencia_dias, total, usuario_id)
       VALUES (@numero, @cliente_id, @vigencia_dias, @total, @usuario_id)`
    )
    .run({
      numero: generarNumero(),
      cliente_id: datos.cliente_id || null,
      vigencia_dias: Number(datos.vigencia_dias) || 15,
      total,
      usuario_id: datos.usuario_id || null,
    });
  const presupuesto_id = info.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO presupuesto_items (presupuesto_id, producto_id, descripcion, cantidad, precio_unitario, descuento, monto_mano_obra)
    VALUES (@presupuesto_id, @producto_id, @descripcion, @cantidad, @precio_unitario, @descuento, @monto_mano_obra)
  `);
  datos.items.forEach((it) => {
    insertItem.run({
      presupuesto_id,
      producto_id: it.producto_id || null,
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad) || 1,
      precio_unitario: Number(it.precio_unitario) || 0,
      descuento: Number(it.descuento) || 0,
      monto_mano_obra: it.monto_mano_obra != null && it.monto_mano_obra !== '' ? Number(it.monto_mano_obra) : null,
    });
  });

  return obtener(presupuesto_id);
});

function obtener(id) {
  const presupuesto = db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(id);
  if (!presupuesto) return null;
  const items = db
    .prepare(
      `SELECT pi.*, p.codigo AS producto_codigo, f.usa_mano_obra,
              p.recargos_mano_obra, f.descuento_debito AS familia_descuento_debito,
              p.precio_final AS producto_precio_final, p.precio_debito AS producto_precio_debito,
              p.precio_efectivo AS producto_precio_efectivo
       FROM presupuesto_items pi
       LEFT JOIN productos p ON p.id = pi.producto_id
       LEFT JOIN familias f ON f.id = p.familia_id
       WHERE pi.presupuesto_id = ? ORDER BY pi.id`
    )
    .all(id);
  const cliente = presupuesto.cliente_id ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(presupuesto.cliente_id) : null;
  return { ...presupuesto, items, cliente };
}

function listar({ estado } = {}) {
  let sql = `
    SELECT p.*, c.nombre AS cliente_nombre
    FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE 1 = 1
  `;
  const params = {};
  if (estado === 'historial') {
    sql += " AND p.estado != 'vigente'";
  } else if (estado) {
    sql += ' AND p.estado = @estado';
    params.estado = estado;
  }
  sql += ' ORDER BY p.id DESC LIMIT 300';
  return db.prepare(sql).all(params);
}

function cerrar(id) {
  const info = db.prepare("UPDATE presupuestos SET estado = 'cerrado' WHERE id = ? AND estado = 'vigente'").run(id);
  return info.changes > 0;
}

module.exports = { crear, obtener, listar, cerrar, generarNumero };
