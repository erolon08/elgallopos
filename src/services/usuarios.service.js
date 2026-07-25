const bcrypt = require('bcryptjs');
const db = require('../db');

const CODIGO_VIGENCIA_MIN = 15;

function listar() {
  return db.prepare('SELECT id, nombre, usuario, rol FROM usuarios WHERE activo = 1 ORDER BY rol').all();
}

function cambiarPassword(id, password) {
  const hash = bcrypt.hashSync(String(password), 8);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, id);
}

// Cambio de clave "normal": hay que conocer la clave actual de ese puesto.
function cambiarPasswordConVerificacion(id, passwordActual, passwordNueva) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) throw new Error('Usuario no encontrado');
  if (!bcrypt.compareSync(String(passwordActual || ''), usuario.password_hash)) {
    throw new Error('La clave actual no es correcta');
  }
  cambiarPassword(id, passwordNueva);
}

// Recuperación sin conocer la clave vieja: genera un código de 6 dígitos con
// vencimiento corto. El código se manda por WhatsApp desde el navegador (no
// hay integración con la API de WhatsApp Business), así que acá solo se
// genera y se guarda — el envío lo hace el frontend abriendo wa.me.
function solicitarRecuperacion(rol) {
  const usuario = db.prepare("SELECT * FROM usuarios WHERE rol = ? AND activo = 1").get(rol);
  if (!usuario) throw new Error('Puesto no encontrado');
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const expira = new Date(Date.now() + CODIGO_VIGENCIA_MIN * 60 * 1000).toISOString();
  db.prepare('UPDATE usuarios SET reset_codigo = ?, reset_expira = ? WHERE id = ?').run(codigo, expira, usuario.id);
  return { codigo, nombre: usuario.nombre };
}

function confirmarRecuperacion(rol, codigo, passwordNueva) {
  const usuario = db.prepare("SELECT * FROM usuarios WHERE rol = ? AND activo = 1").get(rol);
  if (!usuario || !usuario.reset_codigo) throw new Error('No hay ningún código de recuperación pendiente para este puesto');
  if (String(codigo).trim() !== usuario.reset_codigo) throw new Error('El código no es correcto');
  if (new Date(usuario.reset_expira).getTime() < Date.now()) throw new Error('El código venció, pedí uno nuevo');
  cambiarPassword(usuario.id, passwordNueva);
  db.prepare('UPDATE usuarios SET reset_codigo = NULL, reset_expira = NULL WHERE id = ?').run(usuario.id);
}

module.exports = { listar, cambiarPassword, cambiarPasswordConVerificacion, solicitarRecuperacion, confirmarRecuperacion };
