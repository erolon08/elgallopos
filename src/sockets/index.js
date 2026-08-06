let io = null;

function init(server) {
  const { Server } = require('socket.io');
  io = new Server(server, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.on('disconnect', () => {});
  });

  return io;
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

module.exports = { init, emitStockUpdated, emitVentaEvent, emitSistemaReseteado };
