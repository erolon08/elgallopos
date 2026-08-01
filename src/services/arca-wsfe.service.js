// Llamadas al servicio de Facturación Electrónica de ARCA (WSFEv1): las de
// solo-lectura (dummy/ultimoAutorizado) y FECAESolicitar, que sí emite un
// comprobante real e irreversible — la arma con cuidado arca-facturacion.service.js,
// acá solo se manda el pedido tal como llega y se interpreta la respuesta.
const { XMLParser } = require('fast-xml-parser');
const wsaa = require('./arca-wsaa.service');

const WSFE_URL = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx';
const NS = 'http://ar.gov.afip.dif.FEV1/';

function parsear(body) {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(body);
  const fault = parsed?.Envelope?.Body?.Fault;
  if (fault) {
    throw new Error(`ARCA (WSFE) rechazó el pedido: ${fault.faultstring || JSON.stringify(fault)}`);
  }
  return parsed?.Envelope?.Body;
}

// Ping de conectividad puro: no requiere autenticación ni toca nada fiscal.
// Sirve para confirmar que se puede llegar al servidor de ARCA antes de
// meterse con la parte que sí necesita el certificado.
async function dummy() {
  const soapBody = `<FEDummy xmlns="${NS}"/>`;
  const { status, body } = await wsaa.llamarSoap(WSFE_URL, soapBody, `"${NS}FEDummy"`);
  if (status !== 200) throw new Error(`ARCA (WSFE) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);
  const resultado = parsear(body)?.FEDummyResponse?.FEDummyResult;
  if (!resultado) throw new Error(`Respuesta de FEDummy inesperada: ${body.slice(0, 500)}`);
  return resultado; // { AppServer, DbServer, AuthServer }
}

// Último número de comprobante autorizado para un punto de venta + tipo de
// comprobante. También de solo lectura (no crea ni modifica nada), pero a
// diferencia de FEDummy sí requiere el token+sign de WSAA — es la prueba
// completa de que el certificado autoriza de verdad a facturar.
async function ultimoAutorizado(ptoVta, cbteTipo) {
  const { token, sign } = await wsaa.obtenerTicket('wsfe');
  const cuit = wsaa.obtenerCuit();
  const soapBody = `<FECompUltimoAutorizado xmlns="${NS}"><Auth><Token>${token}</Token><Sign>${sign}</Sign><Cuit>${cuit}</Cuit></Auth><PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FECompUltimoAutorizado>`;
  const { status, body } = await wsaa.llamarSoap(WSFE_URL, soapBody, `"${NS}FECompUltimoAutorizado"`);
  if (status !== 200) throw new Error(`ARCA (WSFE) respondió con error HTTP ${status}: ${body.slice(0, 500)}`);
  const resultado = parsear(body)?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
  if (!resultado) throw new Error(`Respuesta de FECompUltimoAutorizado inesperada: ${body.slice(0, 500)}`);
  const errores = resultado.Errors?.Err;
  if (errores) {
    const lista = Array.isArray(errores) ? errores : [errores];
    throw new Error(`ARCA (WSFE) devolvió error: ${lista.map((e) => `[${e.Code}] ${e.Msg}`).join(' | ')}`);
  }
  return resultado; // { PtoVta, CbteTipo, CbteNro }
}

// Pide el CAE (Código de Autorización Electrónico) para UN comprobante —
// esto es lo que efectivamente lo hace válido y fiscal. `detalle` ya tiene
// que venir completo y correcto (lo arma arca-facturacion.service.js);
// acá no se completa ni corrige nada, solo se envía tal cual.
//   detalle: { concepto, docTipo, docNro, cbteNro, cbteFch, impTotal,
//     impNeto, impIva, condicionIvaReceptorId, alicuotas: [{id, baseImp, importe}],
//     fchServDesde, fchServHasta, fchVtoPago } (los 3 últimos solo si concepto != 1)
async function solicitarCAE(ptoVta, cbteTipo, detalle) {
  const { token, sign } = await wsaa.obtenerTicket('wsfe');
  const cuit = wsaa.obtenerCuit();

  const camposServicio =
    detalle.concepto === 1
      ? ''
      : `<FchServDesde>${detalle.fchServDesde}</FchServDesde><FchServHasta>${detalle.fchServHasta}</FchServHasta><FchVtoPago>${detalle.fchVtoPago}</FchVtoPago>`;

  const ivaXml = detalle.alicuotas
    .map(
      (a) =>
        `<AlicIva><Id>${a.id}</Id><BaseImp>${a.baseImp.toFixed(2)}</BaseImp><Importe>${a.importe.toFixed(2)}</Importe></AlicIva>`
    )
    .join('');

  const soapBody = `<FECAESolicitar xmlns="${NS}">
    <Auth><Token>${token}</Token><Sign>${sign}</Sign><Cuit>${cuit}</Cuit></Auth>
    <FeCAEReq>
      <FeCabReq><CantReg>1</CantReg><PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FeCabReq>
      <FeDetReq><FECAEDetRequest>
        <Concepto>${detalle.concepto}</Concepto>
        <DocTipo>${detalle.docTipo}</DocTipo>
        <DocNro>${detalle.docNro}</DocNro>
        <CbteDesde>${detalle.cbteNro}</CbteDesde>
        <CbteHasta>${detalle.cbteNro}</CbteHasta>
        <CbteFch>${detalle.cbteFch}</CbteFch>
        <ImpTotal>${detalle.impTotal.toFixed(2)}</ImpTotal>
        <ImpTotConc>0.00</ImpTotConc>
        <ImpNeto>${detalle.impNeto.toFixed(2)}</ImpNeto>
        <ImpOpEx>0.00</ImpOpEx>
        <ImpIVA>${detalle.impIva.toFixed(2)}</ImpIVA>
        <ImpTrib>0.00</ImpTrib>
        <MonId>PES</MonId>
        <MonCotiz>1</MonCotiz>
        <CondicionIVAReceptorId>${detalle.condicionIvaReceptorId}</CondicionIVAReceptorId>
        ${camposServicio}
        <Iva>${ivaXml}</Iva>
      </FECAEDetRequest></FeDetReq>
    </FeCAEReq>
  </FECAESolicitar>`;

  const { status, body } = await wsaa.llamarSoap(WSFE_URL, soapBody, `"${NS}FECAESolicitar"`);
  if (status !== 200) throw new Error(`ARCA (WSFE) respondió con error HTTP ${status}: ${body.slice(0, 800)}`);

  const resultado = parsear(body)?.FECAESolicitarResponse?.FECAESolicitarResult;
  if (!resultado) throw new Error(`Respuesta de FECAESolicitar inesperada: ${body.slice(0, 800)}`);

  const erroresGenerales = resultado.Errors?.Err;
  if (erroresGenerales) {
    const lista = Array.isArray(erroresGenerales) ? erroresGenerales : [erroresGenerales];
    throw new Error(`ARCA (WSFE) rechazó el pedido antes de procesarlo: ${lista.map((e) => `[${e.Code}] ${e.Msg}`).join(' | ')}`);
  }

  const det = resultado.FeDetResp?.FECAEDetResponse;
  if (!det) throw new Error(`Respuesta de FECAESolicitar sin detalle: ${body.slice(0, 800)}`);

  const observaciones = det.Observaciones?.Obs
    ? (Array.isArray(det.Observaciones.Obs) ? det.Observaciones.Obs : [det.Observaciones.Obs])
        .map((o) => `[${o.Code}] ${o.Msg}`)
        .join(' | ')
    : null;

  if (det.Resultado !== 'A') {
    throw new Error(`ARCA rechazó la factura (Resultado=${det.Resultado}).${observaciones ? ' Observaciones: ' + observaciones : ''}`);
  }

  // fast-xml-parser convierte solo los valores con pinta de número (CAE,
  // fecha AAAAMMDD, número de comprobante) a Number — al guardarlos en una
  // columna de texto SQLite los reconvierte agregando ".0" al final. Se
  // fuerzan a string acá, antes de que lleguen a la base o al ticket.
  return {
    cae: String(det.CAE),
    caeVencimiento: String(det.CAEFchVto), // formato AAAAMMDD
    cbteNro: String(det.CbteDesde),
    observaciones, // puede venir con Resultado=A y observaciones igual (advertencias, no bloquean)
  };
}

module.exports = { dummy, ultimoAutorizado, solicitarCAE };
