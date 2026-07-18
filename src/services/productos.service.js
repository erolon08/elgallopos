const db = require('../db');
const { calcularPrecios, parsearRecargos } = require('./pricing.service');

function estadoStock(p) {
  if (p.stock_actual <= 0) return 'sin_stock';
  if (p.stock_actual < p.stock_minimo) return 'reponer';
  return 'correcto';
}

function esIncompleto(p) {
  if (p.usa_mano_obra) return parsearRecargos(p.recargos_mano_obra).length === 0;
  return !p.proveedor_id || !p.costo || !p.precio_final;
}

function enriquecer(p) {
  return { ...p, estado_stock: estadoStock(p), incompleto: esIncompleto(p) ? 1 : 0 };
}

function listar({ q, familia_id, proveedor_id, stock, incompletos, favorito } = {}) {
  let sql = `
    SELECT p.*, f.nombre AS familia, f.usa_mano_obra, pr.nombre AS proveedor
    FROM productos p
    JOIN familias f ON f.id = p.familia_id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    WHERE p.activo = 1
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
  if (proveedor_id) {
    sql += ' AND p.proveedor_id = @proveedor_id';
    params.proveedor_id = proveedor_id;
  }
  if (favorito === 'true') {
    sql += ' AND p.favorito = 1';
  }
  sql += ' ORDER BY p.descripcion';

  let rows = db.prepare(sql).all(params).map(enriquecer);
  if (stock === 'bajo_minimo') rows = rows.filter((r) => r.estado_stock !== 'correcto');
  if (incompletos === 'true') rows = rows.filter((r) => r.incompleto === 1);
  return rows;
}

function obtener(id) {
  const row = db
    .prepare(
      `SELECT p.*, f.nombre AS familia, f.usa_mano_obra, pr.nombre AS proveedor
       FROM productos p JOIN familias f ON f.id = p.familia_id
       LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
       WHERE p.id = ?`
    )
    .get(id);
  return row ? enriquecer(row) : null;
}

function calcularCamposPrecio(datos, familia) {
  // Servicios: no tienen precio de catálogo, el precio final se calcula en la
  // venta a partir de la mano de obra del trabajo + los recargos del código.
  if (familia.usa_mano_obra) {
    return {
      costo: 0,
      precio_final: 0,
      precio_debito: 0,
      precio_efectivo: 0,
      usar_regla_automatica: 0,
      recargos_mano_obra: datos.recargos_mano_obra ? String(datos.recargos_mano_obra).trim() : null,
    };
  }

  const usarRegla = datos.usar_regla_automatica !== false && datos.usar_regla_automatica !== 0;
  const base = {
    costo: Number(datos.costo) || 0,
    precio_final: Number(datos.precio_final) || 0,
    recargos_mano_obra: null,
  };
  if (usarRegla) {
    const { precio_debito, precio_efectivo } = calcularPrecios(base.precio_final, familia);
    return { ...base, precio_debito, precio_efectivo, usar_regla_automatica: 1 };
  }
  return {
    ...base,
    precio_debito: Number(datos.precio_debito) || 0,
    precio_efectivo: Number(datos.precio_efectivo) || 0,
    usar_regla_automatica: 0,
  };
}

function crear(datos) {
  const familia = db.prepare('SELECT * FROM familias WHERE id = ?').get(datos.familia_id);
  if (!familia) throw new Error('Familia inválida');
  const precioCalculado = calcularCamposPrecio(datos, familia);

  const info = db
    .prepare(
      `INSERT INTO productos
        (codigo, descripcion, familia_id, proveedor_id, costo, precio_final, precio_debito, precio_efectivo,
         precio_rendicion, recargos_mano_obra, usar_regla_automatica, iva, stock_minimo, favorito)
       VALUES (@codigo, @descripcion, @familia_id, @proveedor_id, @costo, @precio_final, @precio_debito, @precio_efectivo,
         @precio_rendicion, @recargos_mano_obra, @usar_regla_automatica, @iva, @stock_minimo, @favorito)`
    )
    .run({
      codigo: String(datos.codigo).trim(),
      descripcion: String(datos.descripcion).trim(),
      familia_id: familia.id,
      proveedor_id: datos.proveedor_id || null,
      ...precioCalculado,
      precio_rendicion: datos.precio_rendicion != null && datos.precio_rendicion !== '' ? Number(datos.precio_rendicion) : null,
      iva: Number(datos.iva) || 0,
      stock_minimo: Number(datos.stock_minimo) || 0,
      favorito: datos.favorito ? 1 : 0,
    });
  return obtener(info.lastInsertRowid);
}

function actualizar(id, datos) {
  const actual = db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
  if (!actual) return null;

  const familia_id = datos.familia_id || actual.familia_id;
  const familia = db.prepare('SELECT * FROM familias WHERE id = ?').get(familia_id);
  if (!familia) throw new Error('Familia inválida');

  const mergedParaPrecio = {
    costo: datos.costo != null ? datos.costo : actual.costo,
    precio_final: datos.precio_final != null ? datos.precio_final : actual.precio_final,
    precio_debito: datos.precio_debito != null ? datos.precio_debito : actual.precio_debito,
    precio_efectivo: datos.precio_efectivo != null ? datos.precio_efectivo : actual.precio_efectivo,
    usar_regla_automatica: datos.usar_regla_automatica != null ? datos.usar_regla_automatica : !!actual.usar_regla_automatica,
    recargos_mano_obra: datos.recargos_mano_obra !== undefined ? datos.recargos_mano_obra : actual.recargos_mano_obra,
  };
  const precioCalculado = calcularCamposPrecio(mergedParaPrecio, familia);

  db.prepare(
    `UPDATE productos SET
       codigo = @codigo, descripcion = @descripcion, familia_id = @familia_id, proveedor_id = @proveedor_id,
       costo = @costo, precio_final = @precio_final, precio_debito = @precio_debito, precio_efectivo = @precio_efectivo,
       precio_rendicion = @precio_rendicion, recargos_mano_obra = @recargos_mano_obra,
       usar_regla_automatica = @usar_regla_automatica, iva = @iva,
       stock_minimo = @stock_minimo, favorito = @favorito, actualizado_en = datetime('now')
     WHERE id = @id`
  ).run({
    id,
    codigo: datos.codigo != null ? String(datos.codigo).trim() : actual.codigo,
    descripcion: datos.descripcion != null ? String(datos.descripcion).trim() : actual.descripcion,
    familia_id,
    proveedor_id: datos.proveedor_id !== undefined ? datos.proveedor_id || null : actual.proveedor_id,
    ...precioCalculado,
    precio_rendicion:
      datos.precio_rendicion !== undefined
        ? datos.precio_rendicion !== '' && datos.precio_rendicion != null
          ? Number(datos.precio_rendicion)
          : null
        : actual.precio_rendicion,
    iva: datos.iva != null ? Number(datos.iva) : actual.iva,
    stock_minimo: datos.stock_minimo != null ? Number(datos.stock_minimo) : actual.stock_minimo,
    favorito: datos.favorito !== undefined ? (datos.favorito ? 1 : 0) : actual.favorito,
  });
  return obtener(id);
}

function desactivar(id) {
  const info = db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(id);
  return info.changes > 0;
}

function toggleFavorito(id) {
  const actual = db.prepare('SELECT favorito FROM productos WHERE id = ?').get(id);
  if (!actual) return null;
  db.prepare('UPDATE productos SET favorito = ? WHERE id = ?').run(actual.favorito ? 0 : 1, id);
  return obtener(id);
}

module.exports = { listar, obtener, crear, actualizar, desactivar, toggleFavorito };
