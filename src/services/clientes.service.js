const db = require('../db');

function normalizarPatente(patente) {
  return String(patente || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Número de cliente autogenerado: nunca lo tipea el usuario, ni al crear ni al importar.
// Arranca en 20.000: mientras el negocio siga cargando clientes en el sistema
// viejo (posberry) en paralelo, esos números van a seguir subiendo desde donde
// están ahora (~17.xxx). Reservando el rango desde 20.000 para los clientes
// nuevos de acá, cuando se importe después una planilla más actual del
// sistema viejo no va a chocar con ninguno de estos códigos.
const CODIGO_CLIENTE_DESDE = 20000;
function generarCodigo() {
  const { max } = db.prepare("SELECT MAX(CAST(codigo AS INTEGER)) AS max FROM clientes").get();
  return String(Math.max((max || 0) + 1, CODIGO_CLIENTE_DESDE));
}

function vehiculosDe(cliente_id) {
  return db.prepare('SELECT * FROM vehiculos WHERE cliente_id = ? ORDER BY id').all(cliente_id);
}

function listar({ q } = {}) {
  let sql = `
    SELECT c.*, (SELECT GROUP_CONCAT(patente, ', ') FROM vehiculos WHERE cliente_id = c.id) AS patentes
    FROM clientes c
    WHERE c.activo = 1
  `;
  const params = {};
  if (q) {
    // Cada palabra buscada puede estar en cualquier parte de cualquiera de
    // estos campos, sin importar el orden ni si están separadas por otro
    // texto (ej: "angela llano" tiene que encontrar "HOSPITAL ANGELA I.
    // LLANO"), así que se exige que TODAS las palabras aparezcan en algún
    // lado, cada una por su cuenta.
    const palabras = q.trim().split(/\s+/).filter(Boolean);
    const condiciones = palabras
      .map(
        (_, i) => `(
          c.nombre LIKE @qPalabra${i} OR c.codigo LIKE @qPalabra${i} OR c.telefono LIKE @qPalabra${i}
          OR c.documento LIKE @qPalabra${i} OR c.cuit LIKE @qPalabra${i}
          OR c.direccion LIKE @qPalabra${i} OR c.localidad LIKE @qPalabra${i}
          OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.cliente_id = c.id AND v.patente LIKE @qPatente${i})
        )`
      )
      .join(' AND ');
    sql += ` AND (${condiciones})`;
    palabras.forEach((palabra, i) => {
      params[`qPalabra${i}`] = `%${palabra}%`;
      params[`qPatente${i}`] = `%${normalizarPatente(palabra)}%`;
    });
    params.qCompletoPrefix = `${q}%`;
    params.qCompleto = `%${q}%`;
  }
  // Con base real de ~18.000 clientes, sin ordenar por relevancia una
  // coincidencia exacta de nombre podía quedar tapada por decenas de otras
  // que matchean por teléfono/dirección/etc. y son alfabéticamente
  // anteriores. Prioriza nombre-empieza-con y nombre-contiene por sobre el
  // resto, y dentro de cada nivel el cliente que más compró va primero.
  sql += q
    ? ` ORDER BY
          CASE
            WHEN c.nombre LIKE @qCompletoPrefix THEN 0
            WHEN c.nombre LIKE @qCompleto THEN 1
            ELSE 2
          END,
          (SELECT COUNT(*) FROM ventas v WHERE v.cliente_id = c.id AND v.estado = 'cobrada') DESC,
          c.nombre
        LIMIT 200`
    : ' ORDER BY c.nombre LIMIT 200';
  return db.prepare(sql).all(params);
}

function obtener(id) {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!cliente) return null;
  return { ...cliente, vehiculos: vehiculosDe(id) };
}

// Busca si ya hay otro cliente activo con el mismo DNI y/o CUIT (excluyendo
// al propio cliente cuando se está editando) — para no cargar el mismo
// cliente dos veces sin darse cuenta. Vacío/null no cuenta como duplicado
// (muchos clientes no tienen DNI o CUIT cargado).
function buscarDuplicado({ documento, cuit, excluir_id }) {
  const resultado = {};
  const doc = documento != null ? String(documento).trim() : '';
  if (doc) {
    let sql = 'SELECT id, codigo, nombre FROM clientes WHERE activo = 1 AND documento = @doc';
    const params = { doc };
    if (excluir_id) {
      sql += ' AND id != @excluir_id';
      params.excluir_id = excluir_id;
    }
    resultado.documento = db.prepare(sql).get(params) || null;
  }
  const cuitTrim = cuit != null ? String(cuit).trim() : '';
  if (cuitTrim) {
    let sql = 'SELECT id, codigo, nombre FROM clientes WHERE activo = 1 AND cuit = @cuit';
    const params = { cuit: cuitTrim };
    if (excluir_id) {
      sql += ' AND id != @excluir_id';
      params.excluir_id = excluir_id;
    }
    resultado.cuit = db.prepare(sql).get(params) || null;
  }
  return resultado;
}

// Búsqueda en vivo mientras se tipea el DNI o CUIT en la ficha de cliente:
// devuelve todos los clientes activos cuyo documento/cuit contiene lo
// tipeado hasta ahora, para mostrarlos como sugerencias tipo buscador. Si
// no hay ninguna coincidencia, el llamador lo interpreta como "cliente
// nuevo".
function buscarPorDocumentoOCuit({ tipo, valor, excluir_id }) {
  const campo = tipo === 'cuit' ? 'cuit' : 'documento';
  const val = valor != null ? String(valor).trim() : '';
  if (!val) return [];
  let sql = `SELECT id, codigo, nombre, documento, cuit FROM clientes WHERE activo = 1 AND ${campo} LIKE @val`;
  const params = { val: `%${val}%`, valPrefix: `${val}%` };
  if (excluir_id) {
    sql += ' AND id != @excluir_id';
    params.excluir_id = excluir_id;
  }
  sql += ` ORDER BY (CASE WHEN ${campo} LIKE @valPrefix THEN 0 ELSE 1 END), nombre LIMIT 8`;
  return db.prepare(sql).all(params);
}

function crear(datos) {
  if (!datos.nombre || !String(datos.nombre).trim()) throw new Error('El nombre es obligatorio');
  const dup = buscarDuplicado({ documento: datos.documento, cuit: datos.cuit });
  if (dup.documento) throw new Error(`Ya existe un cliente con ese DNI: ${dup.documento.nombre} (N° ${dup.documento.codigo})`);
  if (dup.cuit) throw new Error(`Ya existe un cliente con ese CUIT: ${dup.cuit.nombre} (N° ${dup.cuit.codigo})`);
  const codigo = generarCodigo();
  const info = db
    .prepare(
      `INSERT INTO clientes
        (codigo, nombre, telefono, documento, cuit, email, direccion, localidad, condicion_iva, tipo_cliente, venta_a_credito, limite_credito)
       VALUES (@codigo, @nombre, @telefono, @documento, @cuit, @email, @direccion, @localidad, @condicion_iva, @tipo_cliente, @venta_a_credito, @limite_credito)`
    )
    .run({
      codigo,
      nombre: String(datos.nombre).trim(),
      telefono: datos.telefono || null,
      documento: datos.documento || null,
      cuit: datos.cuit || null,
      email: datos.email || null,
      direccion: datos.direccion || null,
      localidad: datos.localidad || null,
      condicion_iva: datos.condicion_iva || 'Consumidor Final',
      tipo_cliente: datos.tipo_cliente || 'GENERAL',
      venta_a_credito: datos.venta_a_credito ? 1 : 0,
      limite_credito: Number(datos.limite_credito) || 0,
    });
  return obtener(info.lastInsertRowid);
}

function actualizar(id, datos) {
  const actual = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
  if (!actual) return null;
  const documento = datos.documento !== undefined ? datos.documento || null : actual.documento;
  const cuit = datos.cuit !== undefined ? datos.cuit || null : actual.cuit;
  const dup = buscarDuplicado({ documento, cuit, excluir_id: id });
  if (dup.documento) throw new Error(`Ya existe un cliente con ese DNI: ${dup.documento.nombre} (N° ${dup.documento.codigo})`);
  if (dup.cuit) throw new Error(`Ya existe un cliente con ese CUIT: ${dup.cuit.nombre} (N° ${dup.cuit.codigo})`);
  db.prepare(
    `UPDATE clientes SET
       nombre = @nombre, telefono = @telefono, documento = @documento, cuit = @cuit, email = @email,
       direccion = @direccion, localidad = @localidad, condicion_iva = @condicion_iva,
       tipo_cliente = @tipo_cliente, venta_a_credito = @venta_a_credito, limite_credito = @limite_credito
     WHERE id = @id`
  ).run({
    id,
    nombre: datos.nombre != null ? String(datos.nombre).trim() : actual.nombre,
    telefono: datos.telefono !== undefined ? datos.telefono || null : actual.telefono,
    documento,
    cuit,
    email: datos.email !== undefined ? datos.email || null : actual.email,
    direccion: datos.direccion !== undefined ? datos.direccion || null : actual.direccion,
    localidad: datos.localidad !== undefined ? datos.localidad || null : actual.localidad,
    condicion_iva: datos.condicion_iva || actual.condicion_iva,
    tipo_cliente: datos.tipo_cliente || actual.tipo_cliente,
    venta_a_credito: datos.venta_a_credito !== undefined ? (datos.venta_a_credito ? 1 : 0) : actual.venta_a_credito,
    limite_credito: datos.limite_credito !== undefined ? Number(datos.limite_credito) || 0 : actual.limite_credito,
  });
  return obtener(id);
}

function desactivar(id) {
  const info = db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(id);
  return info.changes > 0;
}

function agregarVehiculo(cliente_id, datos) {
  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(cliente_id);
  if (!cliente) throw new Error('Cliente no encontrado');
  const patente = datos.patente ? normalizarPatente(datos.patente) : null;
  const info = db
    .prepare('INSERT INTO vehiculos (cliente_id, marca_modelo, patente) VALUES (?, ?, ?)')
    .run(cliente_id, datos.marca_modelo || null, patente);
  return db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(info.lastInsertRowid);
}

function actualizarVehiculo(id, datos) {
  const actual = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(id);
  if (!actual) return null;
  const patente = datos.patente !== undefined ? (datos.patente ? normalizarPatente(datos.patente) : null) : actual.patente;
  db.prepare('UPDATE vehiculos SET marca_modelo = ?, patente = ? WHERE id = ?').run(
    datos.marca_modelo !== undefined ? datos.marca_modelo || null : actual.marca_modelo,
    patente,
    id
  );
  return db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(id);
}

function eliminarVehiculo(id) {
  const info = db.prepare('DELETE FROM vehiculos WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  desactivar,
  agregarVehiculo,
  actualizarVehiculo,
  eliminarVehiculo,
  normalizarPatente,
  generarCodigo,
  buscarDuplicado,
  buscarPorDocumentoOCuit,
};
