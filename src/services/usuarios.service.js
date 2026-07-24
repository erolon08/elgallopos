const bcrypt = require('bcryptjs');
const db = require('../db');

function listar() {
  return db.prepare('SELECT id, nombre, usuario, rol FROM usuarios WHERE activo = 1 ORDER BY rol').all();
}

function cambiarPassword(id, password) {
  const hash = bcrypt.hashSync(String(password), 8);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, id);
}

module.exports = { listar, cambiarPassword };
