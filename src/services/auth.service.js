const bcrypt = require('bcryptjs');
const db = require('../db');

// Login por rol de terminal (ADMIN/CAJA/VENTA), no por empleado individual
// todavía. Cada rol tiene un usuario "compartido" en la tabla usuarios con
// su propia clave.
function login(rol, password) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE rol = ? AND activo = 1').get(rol);
  if (!usuario) return null;
  if (!bcrypt.compareSync(String(password || ''), usuario.password_hash)) return null;
  return { id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol: usuario.rol };
}

module.exports = { login };
