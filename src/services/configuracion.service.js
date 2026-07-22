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
  });
  return obtener();
}

module.exports = { obtener, actualizar };
