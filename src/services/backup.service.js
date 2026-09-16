const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const db = require('../db');

// Un solo archivo de backup que se PISA cada vez (no se acumulan copias por
// día) — vive en una carpeta separada de la base real, al lado de ella.
const CARPETA_BACKUPS = path.join(path.dirname(db.DB_PATH), 'backups');
const ARCHIVO_BACKUP = path.join(CARPETA_BACKUPS, 'gallopos-backup.db');
const ARCHIVO_MARCA = path.join(CARPETA_BACKUPS, 'ultimo-backup.txt');
const ARCHIVO_MARCA_DRIVE = path.join(CARPETA_BACKUPS, 'ultimo-backup-drive.txt');
// Si existe este archivo (con el ID de la carpeta de Drive adentro, sin
// nada más), la subida apunta a esa carpeta por ID en vez de por nombre —
// evita depender de que el nombre/mayúsculas de la carpeta coincidan
// exactamente con lo que espera el código, que es lo que hacía que
// terminara subiendo el backup suelto a la raíz del Drive en vez de a la
// carpeta. Ver el manual para cómo sacar el ID de una carpeta de Drive.
const ARCHIVO_ID_CARPETA_DRIVE = path.join(path.dirname(db.DB_PATH), 'gdrive-carpeta-id.txt');

// Subida a Google Drive con rclone (herramienta externa gratuita: se
// instala y se conecta a la cuenta de Google UNA sola vez en esta PC con
// "rclone config", eligiendo el nombre de remoto de acá abajo — ver el
// manual). Si rclone no está instalado o no está configurado todavía, la
// subida simplemente falla y queda log del error: el backup local diario
// sigue funcionando igual, esto es un paso extra, no un reemplazo.
const GDRIVE_REMOTE = process.env.GDRIVE_REMOTE || 'gdrive';
const GDRIVE_CARPETA = process.env.GDRIVE_BACKUP_FOLDER || 'backup el gallo pos';
const DIAS_ENTRE_BACKUPS_DRIVE = 7;
// En Windows, Node busca el ejecutable con Windows (CreateProcess) directo,
// sin pasar por cmd.exe — así que NO completa la extensión sola como sí
// hace la consola cuando escribís "rclone" a mano (eso lo hace cmd.exe, no
// Windows). Sin el ".exe" explícito, esto tira "spawn rclone ENOENT" aunque
// "rclone.exe" esté perfectamente instalado y en el PATH.
const RCLONE_BIN = process.platform === 'win32' ? 'rclone.exe' : 'rclone';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function diasDesde(fechaISO) {
  if (!fechaISO) return Infinity;
  const ms = Date.now() - new Date(`${fechaISO}T00:00:00`).getTime();
  return ms / (1000 * 60 * 60 * 24);
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

function ultimoBackupDriveFecha() {
  if (!fs.existsSync(ARCHIVO_MARCA_DRIVE)) return null;
  return fs.readFileSync(ARCHIVO_MARCA_DRIVE, 'utf8').trim();
}

function idCarpetaDriveConfigurado() {
  if (!fs.existsSync(ARCHIVO_ID_CARPETA_DRIVE)) return null;
  return fs.readFileSync(ARCHIVO_ID_CARPETA_DRIVE, 'utf8').trim() || null;
}

function estado() {
  const fecha = ultimoBackupFecha();
  const existe = fs.existsSync(ARCHIVO_BACKUP);
  const tamanioBytes = existe ? fs.statSync(ARCHIVO_BACKUP).size : 0;
  return { fecha, existe, tamanioBytes, driveFecha: ultimoBackupDriveFecha(), driveCarpetaPorId: !!idCarpetaDriveConfigurado() };
}

async function hacerBackupSiCorresponde() {
  if (ultimoBackupFecha() === hoyISO()) return false;
  await hacerBackup();
  return true;
}

// Copia el archivo de backup a la carpeta de Drive indicada, vía rclone.
// Si hay un ID de carpeta configurado (ver idCarpetaDriveConfigurado), se
// usa ESE en vez del nombre — así no importa cómo esté escrita la carpeta
// en Drive ni si hay mayúsculas de por medio.
function subirBackupADrive() {
  const idCarpeta = idCarpetaDriveConfigurado();
  const args = idCarpeta
    ? ['copy', ARCHIVO_BACKUP, `${GDRIVE_REMOTE}:`, '--drive-root-folder-id', idCarpeta]
    : ['copy', ARCHIVO_BACKUP, `${GDRIVE_REMOTE}:${GDRIVE_CARPETA}`];
  return new Promise((resolve, reject) => {
    execFile(RCLONE_BIN, args, { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      fs.writeFileSync(ARCHIVO_MARCA_DRIVE, hoyISO());
      resolve();
    });
  });
}

// Sube a Drive si pasó una semana (o más) desde la última subida exitosa.
// No hace falta que el backup local sea de hoy: sube el que haya, así
// siempre queda algo reciente en Drive aunque la PC haya estado apagada.
async function hacerBackupDriveSiCorresponde() {
  if (diasDesde(ultimoBackupDriveFecha()) < DIAS_ENTRE_BACKUPS_DRIVE) return false;
  if (!fs.existsSync(ARCHIVO_BACKUP)) return false;
  await subirBackupADrive();
  return true;
}

// Para el botón "Subir a Google Drive ahora" de Configuración: fuerza un
// backup local fresco y lo sube al toque, sin esperar a que se cumpla la
// semana — pensado para probar que rclone quedó bien configurado.
async function subirBackupADriveAhora() {
  await hacerBackup();
  await subirBackupADrive();
  return ultimoBackupDriveFecha();
}

// Al arrancar el server hace el de hoy si todavía no se hizo (por ejemplo,
// si la PC estuvo apagada), y después revisa una vez por hora si ya cambió
// el día — así no depende de dejar el programa prendido a una hora fija.
// La subida a Drive se revisa en la misma pasada, pero con su propio
// intervalo semanal.
function iniciarProgramador() {
  hacerBackupSiCorresponde().catch((err) => console.error('Error en backup automático:', err.message));
  hacerBackupDriveSiCorresponde().catch((err) => console.error('Error al subir el backup a Google Drive:', err.message));
  setInterval(() => {
    hacerBackupSiCorresponde().catch((err) => console.error('Error en backup automático:', err.message));
    hacerBackupDriveSiCorresponde().catch((err) => console.error('Error al subir el backup a Google Drive:', err.message));
  }, 60 * 60 * 1000);
}

module.exports = {
  hacerBackup,
  hacerBackupSiCorresponde,
  hacerBackupDriveSiCorresponde,
  subirBackupADriveAhora,
  iniciarProgramador,
  estado,
  ARCHIVO_BACKUP,
};
