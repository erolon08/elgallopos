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

module.exports = { init, emitStockUpdated, emitVentaEvent };
