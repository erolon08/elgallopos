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
    SELECT p.*, f.nombre AS familia, f.usa_mano_obra, f.usa_precio_rendicion, f.descuento_debito, f.descuento_efectivo, pr.nombre AS proveedor
    FROM productos p
    JOIN familias f ON f.id = p.familia_id
    LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
    WHERE p.activo = 1
  `;
  const params = {};
  if (q) {
    // Cada palabra buscada puede estar en cualquier parte del código o la
    // descripción, no necesariamente pegadas ni en ese orden (ej: "sekur 50"
    // debe encontrar "SEKUR CANDADO 50"), así que se exige que TODAS las
    // palabras aparezcan, cada una en cualquier lugar de código o descripción.
    const palabras = q.trim().split(/\s+/).filter(Boolean);
    const condiciones = palabras.map((_, i) => `(p.codigo LIKE @qPalabra${i} OR p.descripcion LIKE @qPalabra${i})`).join(' AND ');
    sql += ` AND (${condiciones})`;
    palabras.forEach((palabra, i) => {
      params[`qPalabra${i}`] = `%${palabra}%`;
    });
    params.q = `%${q}%`;
    params.qPrefix = `${q}%`;
    params.qExacto = q;
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
  // Con búsqueda de texto, prioriza coincidencias de código (empieza con, o
  // en cualquier parte) antes que las de descripción, para que no queden
  // tapadas por productos alfabéticamente anteriores que solo matchean
  // por descripción (ej: buscar "805" debe traer primero el código CRZ805).
  // Dentro de cada nivel de relevancia, el que más se vendió va primero
  // (ej: si hay dos productos que matchean igual de bien, el que más se usa
  // sale arriba).
  sql += q
    ? ` ORDER BY
          CASE
            WHEN p.codigo = @qExacto THEN 0
            WHEN p.codigo LIKE @qPrefix THEN 1
            WHEN p.codigo LIKE @q THEN 2
            WHEN p.descripcion LIKE @qPrefix THEN 3
            WHEN p.descripcion LIKE @q THEN 4
            ELSE 5
          END,
          (SELECT COUNT(*) FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id WHERE vi.producto_id = p.id AND v.estado = 'cobrada') DESC,
          p.orden_botonera, p.descripcion`
    : ' ORDER BY p.orden_botonera, p.descripcion';

  let rows = db.prepare(sql).all(params).map(enriquecer);
  if (stock === 'bajo_minimo') rows = rows.filter((r) => r.estado_stock !== 'correcto');
  if (incompletos === 'true') rows = rows.filter((r) => r.incompleto === 1);
  if (q) rows = rows.slice(0, 20);
  return rows;
}

function obtener(id) {
  const row = db
    .prepare(
      `SELECT p.*, f.nombre AS familia, f.usa_mano_obra, f.usa_precio_rendicion, f.descuento_debito, f.descuento_efectivo, pr.nombre AS proveedor
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

  const base = {
    costo: Number(datos.costo) || 0,
    precio_final: Number(datos.precio_final) || 0,
    recargos_mano_obra: null,
  };

  // Familias como DUPLICADOS (copias de llave): un solo precio para las tres
  // formas de pago, sin la regla de descuento débito/efectivo. Se copia tal
  // cual (sin redondear a $100) para que nunca difiera del precio cargado.
  if (familia.usa_precio_rendicion) {
    return { ...base, precio_debito: base.precio_final, precio_efectivo: base.precio_final, usar_regla_automatica: 1 };
  }

  const usarRegla = datos.usar_regla_automatica !== false && datos.usar_regla_automatica !== 0;
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
       stock_minimo = @stock_minimo, favorito = @favorito, actualizado_en = datetime('now','localtime')
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

// Actualización masiva de precios (ej: "el proveedor Bronzen subió el costo
// un 5%"): se sube el costo el % que indique el aumento del proveedor, y el
// precio final sale de aplicarle al costo nuevo el margen fijo del negocio
// (ej. 115% → precio final = costo × 2,15). Aplica a los productos que
// matcheen el filtro (proveedor y/o familia, se combinan con AND). Los
// servicios (usa_mano_obra) quedan afuera siempre: no tienen precio de
// catálogo, su precio sale de la mano de obra en la venta.
function listarParaActualizacionMasiva({ proveedor_id, familia_id }) {
  let sql = `
    SELECT p.*, f.usa_mano_obra, f.usa_precio_rendicion, f.descuento_debito, f.descuento_efectivo
    FROM productos p
    JOIN familias f ON f.id = p.familia_id
    WHERE p.activo = 1 AND f.usa_mano_obra = 0
  `;
  const params = {};
  if (proveedor_id) {
    sql += ' AND p.proveedor_id = @proveedor_id';
    params.proveedor_id = proveedor_id;
  }
  if (familia_id) {
    sql += ' AND p.familia_id = @familia_id';
    params.familia_id = familia_id;
  }
  return db.prepare(sql).all(params);
}

function calcularNuevoPrecioMasivo(p, aumentoCostoPct, margenPct) {
  const costo = Math.round(p.costo * (1 + aumentoCostoPct / 100));
  const precio_final = Math.round(costo * (1 + margenPct / 100));
  let precio_debito;
  let precio_efectivo;
  if (p.usa_precio_rendicion) {
    precio_debito = precio_final;
    precio_efectivo = precio_final;
  } else if (p.usar_regla_automatica) {
    const precios = calcularPrecios(precio_final, { descuento_debito: p.descuento_debito, descuento_efectivo: p.descuento_efectivo });
    precio_debito = precios.precio_debito;
    precio_efectivo = precios.precio_efectivo;
  } else {
    // Precios cargados a mano (regla automática apagada): no hay margen
    // definido para recalcularlos desde el costo, así que se mueven en la
    // misma proporción en que cambió el precio final para no perder la
    // personalización.
    const ratio = p.precio_final ? precio_final / p.precio_final : 1;
    precio_debito = Math.round(p.precio_debito * ratio);
    precio_efectivo = Math.round(p.precio_efectivo * ratio);
  }
  return { costo, precio_final, precio_debito, precio_efectivo };
}

function previsualizarActualizacionMasiva({ proveedor_id, familia_id, aumento_costo, margen }) {
  const aumentoCostoPct = Number(aumento_costo);
  const margenPct = Number(margen);
  return listarParaActualizacionMasiva({ proveedor_id, familia_id }).map((p) => {
    const { costo, precio_final } = calcularNuevoPrecioMasivo(p, aumentoCostoPct, margenPct);
    return {
      id: p.id,
      codigo: p.codigo,
      descripcion: p.descripcion,
      costo_actual: p.costo,
      costo_nuevo: costo,
      precio_final_actual: p.precio_final,
      precio_final_nuevo: precio_final,
    };
  });
}

const aplicarActualizacionMasiva = db.transaction(({ proveedor_id, familia_id, aumento_costo, margen }) => {
  const aumentoCostoPct = Number(aumento_costo);
  const margenPct = Number(margen);
  const productos = listarParaActualizacionMasiva({ proveedor_id, familia_id });
  const update = db.prepare(
    `UPDATE productos SET costo = @costo, precio_final = @precio_final, precio_debito = @precio_debito,
       precio_efectivo = @precio_efectivo, actualizado_en = datetime('now','localtime')
     WHERE id = @id`
  );
  productos.forEach((p) => {
    const { costo, precio_final, precio_debito, precio_efectivo } = calcularNuevoPrecioMasivo(p, aumentoCostoPct, margenPct);
    update.run({ id: p.id, costo, precio_final, precio_debito, precio_efectivo });
  });
  return productos.length;
});

// Recibe el orden completo (array de ids) que el usuario armó a mano en la
// botonera y lo graba como posición (0, 1, 2...) de cada producto. Así evita
// depender de comparar valores previos, que arrancan todos en 0.
const guardarOrdenBotonera = db.transaction((idsEnOrden) => {
  const stmt = db.prepare('UPDATE productos SET orden_botonera = ? WHERE id = ?');
  idsEnOrden.forEach((id, i) => stmt.run(i, Number(id)));
});

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  desactivar,
  toggleFavorito,
  guardarOrdenBotonera,
  previsualizarActualizacionMasiva,
  aplicarActualizacionMasiva,
};
