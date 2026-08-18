const db = require('../db');

// El login es por rol de terminal compartido (ADMIN/CAJA/VENTA/STOCK), no
// por empleado individual, así que la mensajería es rol-a-rol: un mensaje
// "para CAJA" lo ve cualquier terminal logueada con ese puesto.
const ROLES = ['ADMIN', 'CAJA', 'VENTA', 'STOCK'];

function conversacion(rolA, rolB) {
  return db
    .prepare(
      `SELECT * FROM mensajes_internos
       WHERE (de_rol = ? AND para_rol = ?) OR (de_rol = ? AND para_rol = ?)
       ORDER BY id ASC`
    )
    .all(rolA, rolB, rolB, rolA);
}

function enviar({ de_rol, para_rol, texto }) {
  const t = String(texto || '').trim();
  if (!t) throw new Error('Falta el mensaje');
  if (!ROLES.includes(de_rol) || !ROLES.includes(para_rol)) throw new Error('Rol inválido');
  if (de_rol === para_rol) throw new Error('No podés enviarte un mensaje a vos mismo');
  const info = db.prepare('INSERT INTO mensajes_internos (de_rol, para_rol, texto) VALUES (?, ?, ?)').run(de_rol, para_rol, t);
  return db.prepare('SELECT * FROM mensajes_internos WHERE id = ?').get(info.lastInsertRowid);
}

function marcarLeidos(miRol, deRol) {
  db.prepare("UPDATE mensajes_internos SET leido = 1 WHERE para_rol = ? AND de_rol = ? AND leido = 0").run(miRol, deRol);
}

// Cuenta mensajes sin leer dirigidos a "miRol", agrupados por quién los mandó
// — para pintar un contador por conversación además del total.
function noLeidosPorRemitente(miRol) {
  const filas = db
    .prepare('SELECT de_rol, COUNT(*) AS cantidad FROM mensajes_internos WHERE para_rol = ? AND leido = 0 GROUP BY de_rol')
    .all(miRol);
  const resultado = {};
  filas.forEach((f) => {
    resultado[f.de_rol] = f.cantidad;
  });
  return resultado;
}

module.exports = { conversacion, enviar, marcarLeidos, noLeidosPorRemitente, ROLES };
