// Importación de clientes desde Excel (planilla histórica, ~17.879 filas).
// Columnas esperadas, en este orden (planilla real del negocio):
//   0 Codigo | 1 Razón Social | 2 Domicilio | 3 Localidad | 4 Condicion IVA |
//   5 CUIT | 6 Documento | 7 Venta a Credito (S/N) | 8 Limite de Credito |
//   9 Teléfono | 10 Whatsapp (se ignora, es el mismo número) | 11 Tipo de Cliente
//
// El código de la planilla no es único (~79 casos son personas distintas con
// el mismo número por error de carga histórica): a los códigos repetidos se
// les asigna un número nuevo para que todos queden únicos. No importa
// vehículos: se cargan a mano después, según patente.
const db = require('../db');

const COL = {
  CODIGO: 0,
  NOMBRE: 1,
  DOMICILIO: 2,
  LOCALIDAD: 3,
  CONDICION_IVA: 4,
  CUIT: 5,
  DOCUMENTO: 6,
  VENTA_CREDITO: 7,
  LIMITE_CREDITO: 8,
  TELEFONO: 9,
  TIPO_CLIENTE: 11,
};

function limpiar(valor) {
  if (valor == null) return null;
  const texto = String(valor).replace(/_x000D_/g, '').replace(/[\r\n]+/g, ' ').trim();
  return texto || null;
}

function importarClientes(filas) {
  const { maxCodigoActual } = db.prepare("SELECT MAX(CAST(codigo AS INTEGER)) AS maxCodigoActual FROM clientes").get();
  let siguienteCodigo = (maxCodigoActual || 0) + 1;
  const codigosUsados = new Set(
    db.prepare('SELECT codigo FROM clientes WHERE codigo IS NOT NULL').all().map((r) => r.codigo)
  );

  const insert = db.prepare(`
    INSERT INTO clientes
      (codigo, nombre, telefono, documento, cuit, direccion, localidad, condicion_iva, tipo_cliente, venta_a_credito, limite_credito)
    VALUES (@codigo, @nombre, @telefono, @documento, @cuit, @direccion, @localidad, @condicion_iva, @tipo_cliente, @venta_a_credito, @limite_credito)
  `);

  let creados = 0;
  let recodificados = 0;
  let omitidos = 0;
  const errores = [];

  const ejecutar = db.transaction((filas) => {
    filas.forEach((fila, idx) => {
      const numeroFila = idx + 2;
      const nombre = limpiar(fila[COL.NOMBRE]);
      if (!nombre) {
        errores.push({ fila: numeroFila, motivo: 'Falta nombre/razón social' });
        return;
      }

      let codigo = limpiar(fila[COL.CODIGO]);
      // Si el código ya existe (el cliente ya se cargó antes, a mano o en una
      // importación previa) no se duplica: se salta la fila directamente. Solo
      // se recodifica cuando la fila no trae código, para poder darle uno.
      if (codigo && codigosUsados.has(codigo)) {
        omitidos++;
        return;
      }
      if (!codigo) {
        codigo = String(siguienteCodigo);
        recodificados++;
      }
      while (codigosUsados.has(codigo)) {
        siguienteCodigo++;
        codigo = String(siguienteCodigo);
      }
      codigosUsados.add(codigo);
      siguienteCodigo = Math.max(siguienteCodigo, Number(codigo) + 1);

      const ventaCredito = limpiar(fila[COL.VENTA_CREDITO]);

      try {
        insert.run({
          codigo,
          nombre,
          telefono: limpiar(fila[COL.TELEFONO]),
          documento: limpiar(fila[COL.DOCUMENTO]),
          cuit: limpiar(fila[COL.CUIT]),
          direccion: limpiar(fila[COL.DOMICILIO]),
          localidad: limpiar(fila[COL.LOCALIDAD]),
          condicion_iva: limpiar(fila[COL.CONDICION_IVA]) || 'Consumidor Final',
          tipo_cliente: limpiar(fila[COL.TIPO_CLIENTE]) || 'GENERAL',
          venta_a_credito: ventaCredito && ventaCredito.toUpperCase() === 'S' ? 1 : 0,
          limite_credito: Number(fila[COL.LIMITE_CREDITO]) || 0,
        });
        creados++;
      } catch (err) {
        errores.push({ fila: numeroFila, codigo, motivo: err.message });
      }
    });
  });
  ejecutar(filas);

  return { creados, recodificados, omitidos, totalErrores: errores.length, errores: errores.slice(0, 50) };
}

module.exports = { importarClientes };
