// backend/utils/socket.js
let _io = null;

function setIo(io) {
  _io = io;
}

function getIo() {
  if (!_io) {
    throw new Error('Socket.io not initialized. Call setIo(io) from server.js first.');
  }
  return _io;
}

module.exports = { setIo, getIo };
