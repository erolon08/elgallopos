// Arma los datos de una factura electrónica a partir de un total (con IVA
// incluido, como maneja Gallo POS) y los datos del cliente, y pide el CAE a
// ARCA. Esto SÍ emite un comprobante real e irreversible — no hay forma de
// "deshacer" una factura ya autorizada, solo notas de crédito (que todavía
// no está implementado). Por eso valida todo antes de mandar el pedido.
const wsfe = require('./arca-wsfe.service');

const CBTE_TIPO = { 'Factura A': 1, 'Factura B': 6 };

// Único IVA que maneja el negocio por ahora (21%, la alícuota general — la
// gran mayoría de productos/servicios de una cerrajería no tienen un
// tratamiento de IVA distinto). Si en algún momento hace falta discriminar
// otra alícuota, hay que sumar lógica acá.
const ALICUOTA_IVA_PCT = 21;
const ALICUOTA_IVA_ID = 5;

// Condición frente al IVA del receptor (RG 5259, obligatorio en todo
// comprobante desde 2022): mapea el texto que ya usa el sistema en la ficha
// del cliente al código que pide ARCA.
const CONDICION_IVA_RECEPTOR = {
  'Responsable Inscripto': 1,
  Exento: 4,
  'Consumidor Final': 5,
  Monotributista: 6,
  Eventual: 5,
};

function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function datosReceptor(cliente) {
  const cuit = cliente?.cuit && String(cliente.cuit).replace(/\D/g, '');
  if (cuit && cuit.length === 11) return { docTipo: 80, docNro: cuit };
  const dni = cliente?.documento && String(cliente.documento).replace(/\D/g, '');
  if (dni) return { docTipo: 96, docNro: dni };
  return { docTipo: 99, docNro: '0' };
}

function condicionIvaReceptor(cliente) {
  return CONDICION_IVA_RECEPTOR[cliente?.condicion_iva] || 5;
}

function fechaAfip(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

// concepto: 1 = productos, 2 = servicios, 3 = productos y servicios.
// total: importe final que paga el cliente, CON IVA incluido (así maneja
// los precios Gallo POS) — acá se descompone en neto + IVA para ARCA.
async function emitirFactura({ tipoComprobante, total, cliente, ptoVta, concepto = 1 }) {
  const cbteTipo = CBTE_TIPO[tipoComprobante];
  if (!cbteTipo) {
    throw new Error(`"${tipoComprobante}" no se puede facturar electrónicamente (solo Factura A o Factura B).`);
  }
  if (!ptoVta) throw new Error('Falta el número de Punto de Venta.');

  const { docTipo, docNro } = datosReceptor(cliente);
  if (cbteTipo === 1 && docTipo !== 80) {
    throw new Error('Para Factura A el cliente tiene que tener un CUIT cargado (no alcanza con DNI ni Consumidor Final).');
  }

  const impTotal = redondear2(total);
  if (!(impTotal > 0)) throw new Error('El total de la factura tiene que ser mayor a 0.');
  const impNeto = redondear2(impTotal / (1 + ALICUOTA_IVA_PCT / 100));
  const impIva = redondear2(impTotal - impNeto);

  const { CbteNro } = await wsfe.ultimoAutorizado(ptoVta, cbteTipo);
  const cbteNro = Number(CbteNro) + 1;
  const fecha = fechaAfip();

  const detalle = {
    concepto,
    docTipo,
    docNro,
    cbteNro,
    cbteFch: fecha,
    impTotal,
    impNeto,
    impIva,
    condicionIvaReceptorId: condicionIvaReceptor(cliente),
    alicuotas: [{ id: ALICUOTA_IVA_ID, baseImp: impNeto, importe: impIva }],
  };
  if (concepto !== 1) {
    detalle.fchServDesde = fecha;
    detalle.fchServHasta = fecha;
    detalle.fchVtoPago = fecha;
  }

  const resultado = await wsfe.solicitarCAE(ptoVta, cbteTipo, detalle);
  return {
    ...resultado,
    ptoVta,
    cbteTipo,
    tipoComprobante,
    numeroCompleto: `${String(ptoVta).padStart(5, '0')}-${String(resultado.cbteNro).padStart(8, '0')}`,
    impTotal,
    impNeto,
    impIva,
  };
}

module.exports = { emitirFactura };
