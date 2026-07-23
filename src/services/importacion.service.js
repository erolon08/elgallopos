// Importación de productos desde Excel (planilla histórica, ~11.000 filas).
// Columnas esperadas, en este orden (planilla real del negocio):
//   0 Codigo | 1 Descripcion | 2 Familia | 3 Costo | 4 Precio final |
//   5 Debito/Transferencia (se ignora, se recalcula) | 6 Efectivo (se ignora) |
//   7 Stock Minimo | 8 Proveedor | 9 IVA (vacía en la planilla real, default 21)
const db = require('../db');
const { calcularPrecios } = require('./pricing.service');

const COL = {
  CODIGO: 0,
  DESCRIPCION: 1,
  FAMILIA: 2,
  COSTO: 3,
  PRECIO_FINAL: 4,
  STOCK_MINIMO: 7,
  PROVEEDOR: 8,
  IVA: 9,
};

function normalizarFamilia(nombreRaw) {
  const trimmed = String(nombreRaw ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'sin especificar') return 'GENERAL';
  const upper = trimmed.toUpperCase();
  // Agrupa variantes de texto ("SERVICIO", "SERVICIOS CERRAJERO", etc.) en las
  // familias especiales que ya existen, para no crear una familia nueva sin
  // "usa_mano_obra"/"usa_precio_rendicion" y que el producto pierda esas reglas.
  if (upper.includes('SERVICIO')) return 'SERVICIOS';
  if (upper.includes('DUPLICADO')) return 'DUPLICADOS';
  return upper;
}

// filas: array de arrays (una fila de la planilla = un array de celdas), sin la fila de encabezado.
function importarProductos(filas) {
  const familiasAntes = new Set(db.prepare('SELECT nombre FROM familias').all().map((f) => f.nombre));

  const getFamiliaPorNombre = db.prepare('SELECT * FROM familias WHERE nombre = ?');
  const insertFamilia = db.prepare(
    `INSERT INTO familias (nombre, descuento_debito, descuento_efectivo, usa_precio_rendicion, usa_mano_obra)
     VALUES (?, 20, 30, 0, 0)`
  );
  const familiaCache = new Map();
  function obtenerFamilia(nombreRaw) {
    const nombre = normalizarFamilia(nombreRaw);
    if (familiaCache.has(nombre)) return familiaCache.get(nombre);
    let familia = getFamiliaPorNombre.get(nombre);
    if (!familia) {
      insertFamilia.run(nombre);
      familia = getFamiliaPorNombre.get(nombre);
    }
    familiaCache.set(nombre, familia);
    return familia;
  }

  const getProveedorPorNombre = db.prepare('SELECT id FROM proveedores WHERE nombre = ? COLLATE NOCASE');
  const insertProveedor = db.prepare('INSERT INTO proveedores (nombre) VALUES (?)');
  const proveedorCache = new Map();
  function obtenerProveedorId(nombreRaw) {
    const nombre = String(nombreRaw ?? '').trim();
    if (!nombre) return null;
    const key = nombre.toLowerCase();
    if (proveedorCache.has(key)) return proveedorCache.get(key);
    let prov = getProveedorPorNombre.get(nombre);
    let id;
    if (prov) {
      id = prov.id;
    } else {
      id = insertProveedor.run(nombre).lastInsertRowid;
    }
    proveedorCache.set(key, id);
    return id;
  }

  const existeCodigo = db.prepare('SELECT 1 FROM productos WHERE codigo = ?');
  const upsert = db.prepare(`
    INSERT INTO productos
      (codigo, descripcion, familia_id, proveedor_id, costo, precio_final, precio_debito, precio_efectivo, iva, stock_minimo)
    VALUES (@codigo, @descripcion, @familia_id, @proveedor_id, @costo, @precio_final, @precio_debito, @precio_efectivo, @iva, @stock_minimo)
    ON CONFLICT(codigo) DO UPDATE SET
      descripcion = excluded.descripcion,
      familia_id = excluded.familia_id,
      proveedor_id = excluded.proveedor_id,
      costo = excluded.costo,
      precio_final = excluded.precio_final,
      precio_debito = excluded.precio_debito,
      precio_efectivo = excluded.precio_efectivo,
      iva = excluded.iva,
      stock_minimo = excluded.stock_minimo,
      actualizado_en = datetime('now','localtime')
  `);

  let creados = 0;
  let actualizados = 0;
  const errores = [];

  const ejecutar = db.transaction((filas) => {
    filas.forEach((fila, idx) => {
      const numeroFila = idx + 2; // +1 por índice base 1, +1 por la fila de encabezado
      const codigo = String(fila[COL.CODIGO] ?? '').trim();
      const descripcion = String(fila[COL.DESCRIPCION] ?? '').trim();
      if (!codigo || !descripcion) {
        errores.push({ fila: numeroFila, motivo: 'Falta código o descripción' });
        return;
      }

      const familia = obtenerFamilia(fila[COL.FAMILIA]);
      const esServicio = !!familia.usa_mano_obra;

      let costo = 0;
      let precioFinal = 0;
      let precioDebito = 0;
      let precioEfectivo = 0;
      if (!esServicio) {
        costo = Number(fila[COL.COSTO]) || 0;
        precioFinal = Number(fila[COL.PRECIO_FINAL]) || 0;
        if (familia.usa_precio_rendicion) {
          // Familias de precio único (ej. DUPLICADOS): sin regla de descuento,
          // copiado tal cual para que nunca difiera del precio de la planilla.
          precioDebito = precioFinal;
          precioEfectivo = precioFinal;
        } else {
          const precios = calcularPrecios(precioFinal, familia);
          precioDebito = precios.precio_debito;
          precioEfectivo = precios.precio_efectivo;
        }
      }

      const yaExistia = !!existeCodigo.get(codigo);
      try {
        upsert.run({
          codigo,
          descripcion,
          familia_id: familia.id,
          proveedor_id: obtenerProveedorId(fila[COL.PROVEEDOR]),
          costo,
          precio_final: precioFinal,
          precio_debito: precioDebito,
          precio_efectivo: precioEfectivo,
          iva: Number(fila[COL.IVA]) || 21,
          stock_minimo: Number(fila[COL.STOCK_MINIMO]) || 0,
        });
        if (yaExistia) actualizados++;
        else creados++;
      } catch (err) {
        errores.push({ fila: numeroFila, codigo, motivo: err.message });
      }
    });
  });
  ejecutar(filas);

  const familiasDespues = db.prepare('SELECT nombre FROM familias').all().map((f) => f.nombre);
  const familiasNuevas = familiasDespues.filter((n) => !familiasAntes.has(n));

  return { creados, actualizados, familiasNuevas, totalErrores: errores.length, errores: errores.slice(0, 50) };
}

module.exports = { importarProductos, normalizarFamilia };
