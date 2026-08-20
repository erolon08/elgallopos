const db = require('../db');

function obtener() {
  return db.prepare('SELECT * FROM configuracion WHERE id = 1').get();
}

function actualizar(datos) {
  const actual = obtener();
  db.prepare(
    `UPDATE configuracion SET
       nombre_negocio = @nombre_negocio, subtitulo = @subtitulo, logo_url = @logo_url,
       ticket_encabezado = @ticket_encabezado, ticket_pie = @ticket_pie,
       impresora_nombre = @impresora_nombre, impresora_ancho_mm = @impresora_ancho_mm,
       responsable_nombre = @responsable_nombre, cuit_negocio = @cuit_negocio,
       domicilio_negocio = @domicilio_negocio, condicion_fiscal_negocio = @condicion_fiscal_negocio,
       inicio_actividades = @inicio_actividades, ingresos_brutos = @ingresos_brutos,
       telefono_recuperacion = @telefono_recuperacion,
       arca_punto_venta = @arca_punto_venta, arca_facturacion_activa = @arca_facturacion_activa,
       mp_access_token = @mp_access_token, mp_activo = @mp_activo,
       whatsapp_token = @whatsapp_token, whatsapp_phone_number_id = @whatsapp_phone_number_id,
       whatsapp_verify_token = @whatsapp_verify_token, whatsapp_activo = @whatsapp_activo,
       whatsapp_instrucciones = @whatsapp_instrucciones, anthropic_api_key = @anthropic_api_key,
       actualizado_en = datetime('now','localtime')
     WHERE id = 1`
  ).run({
    nombre_negocio: (datos.nombre_negocio ?? actual.nombre_negocio) || 'CERRAJERÍA EL GALLO',
    subtitulo: (datos.subtitulo ?? actual.subtitulo) || '',
    logo_url: datos.logo_url !== undefined ? datos.logo_url : actual.logo_url,
    ticket_encabezado: datos.ticket_encabezado !== undefined ? datos.ticket_encabezado : actual.ticket_encabezado,
    ticket_pie: datos.ticket_pie !== undefined ? datos.ticket_pie : actual.ticket_pie,
    impresora_nombre: datos.impresora_nombre !== undefined ? datos.impresora_nombre : actual.impresora_nombre,
    impresora_ancho_mm: datos.impresora_ancho_mm != null ? Number(datos.impresora_ancho_mm) : actual.impresora_ancho_mm,
    responsable_nombre: datos.responsable_nombre !== undefined ? datos.responsable_nombre : actual.responsable_nombre,
    cuit_negocio: datos.cuit_negocio !== undefined ? datos.cuit_negocio : actual.cuit_negocio,
    domicilio_negocio: datos.domicilio_negocio !== undefined ? datos.domicilio_negocio : actual.domicilio_negocio,
    condicion_fiscal_negocio: datos.condicion_fiscal_negocio !== undefined ? datos.condicion_fiscal_negocio : actual.condicion_fiscal_negocio,
    inicio_actividades: datos.inicio_actividades !== undefined ? datos.inicio_actividades : actual.inicio_actividades,
    ingresos_brutos: datos.ingresos_brutos !== undefined ? datos.ingresos_brutos : actual.ingresos_brutos,
    telefono_recuperacion: datos.telefono_recuperacion !== undefined ? datos.telefono_recuperacion : actual.telefono_recuperacion,
    arca_punto_venta: datos.arca_punto_venta !== undefined ? datos.arca_punto_venta : actual.arca_punto_venta,
    arca_facturacion_activa:
      datos.arca_facturacion_activa !== undefined ? (datos.arca_facturacion_activa ? 1 : 0) : actual.arca_facturacion_activa,
    mp_access_token: datos.mp_access_token !== undefined ? datos.mp_access_token : actual.mp_access_token,
    mp_activo: datos.mp_activo !== undefined ? (datos.mp_activo ? 1 : 0) : actual.mp_activo,
    whatsapp_token: datos.whatsapp_token !== undefined ? datos.whatsapp_token : actual.whatsapp_token,
    whatsapp_phone_number_id:
      datos.whatsapp_phone_number_id !== undefined ? datos.whatsapp_phone_number_id : actual.whatsapp_phone_number_id,
    whatsapp_verify_token:
      datos.whatsapp_verify_token !== undefined ? datos.whatsapp_verify_token : actual.whatsapp_verify_token,
    whatsapp_activo: datos.whatsapp_activo !== undefined ? (datos.whatsapp_activo ? 1 : 0) : actual.whatsapp_activo,
    whatsapp_instrucciones:
      datos.whatsapp_instrucciones !== undefined ? datos.whatsapp_instrucciones : actual.whatsapp_instrucciones,
    anthropic_api_key: datos.anthropic_api_key !== undefined ? datos.anthropic_api_key : actual.anthropic_api_key,
  });
  return obtener();
}

module.exports = { obtener, actualizar };
