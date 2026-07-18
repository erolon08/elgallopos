// Datos de prueba para desarrollo. La carga real de productos/clientes será
// por importación de Excel (módulos siguientes); esto es solo para poder
// probar el módulo de Stock con datos representativos.
const bcrypt = require('bcryptjs');
const db = require('./index');
const { calcularPrecios } = require('../services/pricing.service');

// Usuarios "de rol" para el login por terminal (ADMIN/CAJA/VENTA). Claves
// demo, se cambian desde la base cuando el sistema entre en producción.
const insertUsuario = db.prepare(`
  INSERT OR IGNORE INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)
`);
[
  ['Administrador', 'admin', '1111', 'ADMIN'],
  ['Caja', 'caja', '2222', 'CAJA'],
  ['Venta', 'venta', '3333', 'VENTA'],
].forEach(([nombre, usuario, clave, rol]) => insertUsuario.run(nombre, usuario, bcrypt.hashSync(clave, 8), rol));

const insertFamilia = db.prepare(`
  INSERT OR IGNORE INTO familias (nombre, descuento_debito, descuento_efectivo, usa_precio_rendicion, usa_mano_obra)
  VALUES (@nombre, @descuento_debito, @descuento_efectivo, @usa_precio_rendicion, @usa_mano_obra)
`);

const familias = [
  { nombre: 'CODIFICADOS', descuento_debito: 15, descuento_efectivo: 35, usa_precio_rendicion: 0, usa_mano_obra: 0 },
  { nombre: 'CERRADURAS', descuento_debito: 20, descuento_efectivo: 30, usa_precio_rendicion: 0, usa_mano_obra: 0 },
  { nombre: 'MANIJAS', descuento_debito: 20, descuento_efectivo: 30, usa_precio_rendicion: 0, usa_mano_obra: 0 },
  { nombre: 'CANDADOS', descuento_debito: 20, descuento_efectivo: 30, usa_precio_rendicion: 0, usa_mano_obra: 0 },
  { nombre: 'DUPLICADOS', descuento_debito: 20, descuento_efectivo: 30, usa_precio_rendicion: 1, usa_mano_obra: 0 },
  { nombre: 'SERVICIOS', descuento_debito: 0, descuento_efectivo: 0, usa_precio_rendicion: 0, usa_mano_obra: 1 },
  { nombre: 'GENERAL', descuento_debito: 20, descuento_efectivo: 30, usa_precio_rendicion: 0, usa_mano_obra: 0 },
];
for (const f of familias) insertFamilia.run(f);

const insertProveedor = db.prepare('INSERT OR IGNORE INTO proveedores (nombre) VALUES (?)');
['Bronzen', 'Sekur', 'Genérico'].forEach((n) => insertProveedor.run(n));

const getFamiliaId = (nombre) => db.prepare('SELECT id FROM familias WHERE nombre = ?').get(nombre).id;
const getProveedorId = (nombre) => db.prepare('SELECT id FROM proveedores WHERE nombre = ?').get(nombre).id;

const insertProducto = db.prepare(`
  INSERT OR IGNORE INTO productos
    (codigo, descripcion, familia_id, proveedor_id, costo, precio_final, precio_debito, precio_efectivo,
     precio_rendicion, recargos_mano_obra, iva, stock_actual, stock_minimo, favorito)
  VALUES (@codigo, @descripcion, @familia_id, @proveedor_id, @costo, @precio_final, @precio_debito, @precio_efectivo,
     @precio_rendicion, @recargos_mano_obra, @iva, @stock_actual, @stock_minimo, @favorito)
`);

const productosBase = [
  { codigo: 'CRZ805', descripcion: 'Cerrojo Cruz Bronzen 805', familia: 'CERRADURAS', proveedor: 'Bronzen', costo: 8400, precio_final: 15000, stock_actual: 3, stock_minimo: 5, favorito: 1 },
  { codigo: 'CERRDP', descripcion: 'Cerradura doble paleta', familia: 'CERRADURAS', proveedor: 'Genérico', costo: 160000, precio_final: 286700, stock_actual: 18, stock_minimo: 6, favorito: 1 },
  { codigo: 'PRIVE01', descripcion: 'Cerradura Prive', familia: 'CERRADURAS', proveedor: 'Genérico', costo: 9000, precio_final: 15600, stock_actual: 12, stock_minimo: 4 },
  { codigo: 'SEK40', descripcion: 'Candado Sekur 40', familia: 'CANDADOS', proveedor: 'Sekur', costo: 24000, precio_final: 44300, stock_actual: 9, stock_minimo: 3 },
  { codigo: 'LL1', descripcion: 'Duplicado llave común', familia: 'DUPLICADOS', proveedor: 'Genérico', costo: 900, precio_final: 3500, precio_rendicion: 1700, stock_actual: 500, stock_minimo: 50, favorito: 1 },
  { codigo: 'LL2', descripcion: 'Duplicado llave doble paleta', familia: 'DUPLICADOS', proveedor: 'Genérico', costo: 1800, precio_final: 7000, precio_rendicion: 3350, stock_actual: 300, stock_minimo: 50, favorito: 1 },
  { codigo: 'LLCOD', descripcion: 'Duplicado auto codificada', familia: 'CODIFICADOS', proveedor: 'Genérico', costo: 9000, precio_final: 25000, stock_actual: 40, stock_minimo: 10 },
  // Servicios 1001-1009: no tienen costo/precio de catálogo, precio final = mano de
  // obra + recargos en cadena. Los 9 códigos funcionan todos igual (misma familia
  // SERVICIOS), cada uno con su propia lista de recargos.
  { codigo: '1001', descripcion: 'Destrabe de cerradura', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0, favorito: 1 },
  { codigo: '1002', descripcion: 'Cambio de combinación', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0, favorito: 1 },
  { codigo: '1003', descripcion: 'Servicio de codificados', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21,18', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1004', descripcion: 'Apertura de domicilio', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1005', descripcion: 'Colocación de cerradura', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1006', descripcion: 'Reparación de mando', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1007', descripcion: 'Apertura de vehículo', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21,18', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1008', descripcion: 'Duplicado de mando', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21,18', stock_actual: 0, stock_minimo: 0 },
  { codigo: '1009', descripcion: 'Servicio general', familia: 'SERVICIOS', proveedor: 'Genérico', recargos_mano_obra: '11,21', stock_actual: 0, stock_minimo: 0 },
];

for (const p of productosBase) {
  const familia = db.prepare('SELECT * FROM familias WHERE id = ?').get(getFamiliaId(p.familia));
  const esServicio = !!familia.usa_mano_obra;
  const precioFinal = p.precio_final || 0;
  const { precio_debito, precio_efectivo } = esServicio
    ? { precio_debito: 0, precio_efectivo: 0 }
    : calcularPrecios(precioFinal, familia);
  insertProducto.run({
    codigo: p.codigo,
    descripcion: p.descripcion,
    familia_id: familia.id,
    proveedor_id: getProveedorId(p.proveedor),
    costo: esServicio ? 0 : p.costo || 0,
    precio_final: esServicio ? 0 : precioFinal,
    precio_debito,
    precio_efectivo,
    precio_rendicion: p.precio_rendicion || null,
    recargos_mano_obra: p.recargos_mano_obra || null,
    iva: 21,
    stock_actual: p.stock_actual,
    stock_minimo: p.stock_minimo,
    favorito: p.favorito ? 1 : 0,
  });
}

const insertCerrajero = db.prepare(`
  INSERT OR IGNORE INTO cerrajeros (nombre, porcentaje_rendicion, aporte_fijo) VALUES (?, 30, ?)
`);
[['Samuel', 10000], ['Facundo', 10000], ['Adrián', 0], ['César', 0]].forEach(([nombre, aporte]) =>
  insertCerrajero.run(nombre, aporte)
);

console.log('Seed completo.');
