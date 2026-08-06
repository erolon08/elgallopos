const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');

// Un solo archivo de backup que se PISA cada vez (no se acumulan copias por
// día) — vive en una carpeta separada de la base real, al lado de ella.
const CARPETA_BACKUPS = path.join(path.dirname(db.DB_PATH), 'backups');
const ARCHIVO_BACKUP = path.join(CARPETA_BACKUPS, 'gallopos-backup.db');
const ARCHIVO_MARCA = path.join(CARPETA_BACKUPS, 'ultimo-backup.txt');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Usa el backup nativo de SQLite (no una copia de archivo a mano): así no
// arrastra datos a medio escribir si justo hay una operación en curso, y
// funciona bien con journal_mode = WAL.
async function hacerBackup() {
  fs.mkdirSync(CARPETA_BACKUPS, { recursive: true });
  await db.backup(ARCHIVO_BACKUP);
  fs.writeFileSync(ARCHIVO_MARCA, hoyISO());
  return ARCHIVO_BACKUP;
}

function ultimoBackupFecha() {
  if (!fs.existsSync(ARCHIVO_MARCA)) return null;
  return fs.readFileSync(ARCHIVO_MARCA, 'utf8').trim();
}

function estado() {
  const fecha = ultimoBackupFecha();
  const existe = fs.existsSync(ARCHIVO_BACKUP);
  const tamanioBytes = existe ? fs.statSync(ARCHIVO_BACKUP).size : 0;
  return { fecha, existe, tamanioBytes };
}

async function hacerBackupSiCorresponde() {
  if (ultimoBackupFecha() === hoyISO()) return false;
  await hacerBackup();
  return true;
}

// Al arrancar el server hace el de hoy si todavía no se hizo (por ejemplo,
// si la PC estuvo apagada), y después revisa una vez por hora si ya cambió
// el día — así no depende de dejar el programa prendido a una hora fija.
function iniciarProgramador() {
  hacerBackupSiCorresponde().catch((err) => console.error('Error en backup automático:', err.message));
  setInterval(() => {
    hacerBackupSiCorresponde().catch((err) => console.error('Error en backup automático:', err.message));
  }, 60 * 60 * 1000);
}

module.exports = { hacerBackup, hacerBackupSiCorresponde, iniciarProgramador, estado, ARCHIVO_BACKUP };
