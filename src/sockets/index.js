let io = null;

function init(server) {
  const { Server } = require('socket.io');
  io = new Server(server, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.on('disconnect', () => {});
  });

  return io;
}

// Suma otro servidor HTTP(S) al mismo io — se usa para que el server HTTP
// (puerto 3000) y el HTTPS (puerto 3443) compartan las mismas salas y
// eventos en tiempo real en vez de quedar aislados entre sí.
function attach(server) {
  if (io) io.attach(server, { cors: { origin: '*' } });
}

function emitStockUpdated(producto) {
  if (io) io.emit('stock:updated', producto);
}

function emitVentaEvent(evento, venta) {
  if (io) io.emit(evento, venta);
}

// Avisa a todas las terminales conectadas (LAN) que se reseteó el sistema,
// para que recarguen en vez de seguir operando sobre un turno de caja o
// venta que ya no existe.
function emitSistemaReseteado() {
  if (io) io.emit('sistema:reseteado');
}

module.exports = { init, attach, emitStockUpdated, emitVentaEvent, emitSistemaReseteado };
