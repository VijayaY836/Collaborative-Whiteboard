const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---- In-memory room state -------------------------------------------------
// rooms: Map<roomId, { users: Map<socketId, {name, color}>, history: Array<Op> }>
const rooms = new Map();

const PALETTE = [
  '#FF6B4A', // coral
  '#3654FF', // ink blue
  '#22C39E', // teal
  '#F7B733', // amber
  '#B25CFF', // violet
  '#FF4F9A', // pink
  '#4AD4FF', // sky
  '#7CFF6B'  // lime
];

const ADJECTIVES = ['Swift', 'Quiet', 'Bold', 'Amber', 'Cosmic', 'Nimble', 'Gentle', 'Vivid', 'Lucky', 'Bright'];
const ANIMALS = ['Fox', 'Otter', 'Falcon', 'Wren', 'Lynx', 'Heron', 'Badger', 'Sparrow', 'Hare', 'Owl'];

function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${b}`;
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { users: new Map(), history: [] });
  }
  return rooms.get(roomId);
}

function colorForRoom(roomId) {
  const room = getRoom(roomId);
  const used = new Set([...room.users.values()].map(u => u.color));
  const free = PALETTE.find(c => !used.has(c));
  return free || PALETTE[room.users.size % PALETTE.length];
}

function userList(roomId) {
  const room = getRoom(roomId);
  return [...room.users.entries()].map(([id, u]) => ({ id, name: u.name, color: u.color }));
}

// Cap history so memory doesn't grow forever on long-lived rooms.
const MAX_HISTORY = 8000;
function pushHistory(roomId, op) {
  const room = getRoom(roomId);
  room.history.push(op);
  if (room.history.length > MAX_HISTORY) {
    room.history.splice(0, room.history.length - MAX_HISTORY);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ room, name }, ack) => {
    const roomId = (room || 'main').trim().slice(0, 40) || 'main';
    currentRoom = roomId;
    socket.join(roomId);

    const state = getRoom(roomId);
    const color = colorForRoom(roomId);
    const displayName = (name || '').trim().slice(0, 24) || randomName();
    state.users.set(socket.id, { name: displayName, color });

    if (typeof ack === 'function') {
      ack({
        self: { id: socket.id, name: displayName, color },
        users: userList(roomId),
        history: state.history
      });
    }

    socket.to(roomId).emit('user-joined', { id: socket.id, name: displayName, color });
    io.to(roomId).emit('user-list', userList(roomId));
  });

  // A stroke segment: {strokeId, x0,y0,x1,y1,color,size,tool}
  // A shape: {strokeId, shape:'line'|'rectangle'|'circle', x0,y0,x1,y1,color,size}
  // A text op: {strokeId, x,y,text,color,fontSize}
  // All three are handled identically by the server: tag with owner, store, relay.
  function registerDrawHandler(eventName) {
    socket.on(eventName, (payload) => {
      if (!currentRoom) return;
      const op = { ...payload, ownerId: socket.id };
      pushHistory(currentRoom, op);
      socket.to(currentRoom).emit(eventName, { ...payload, id: socket.id });
    });
  }
  registerDrawHandler('draw-segment');
  registerDrawHandler('draw-shape');
  registerDrawHandler('draw-text');

  socket.on('cursor-move', (pos) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('cursor-move', { id: socket.id, ...pos });
  });

  socket.on('undo-stroke', (strokeId) => {
    if (!currentRoom || !strokeId) return;
    const state = getRoom(currentRoom);
    state.history = state.history.filter(
      (op) => !(op.strokeId === strokeId && op.ownerId === socket.id)
    );
    io.to(currentRoom).emit('redraw-all', state.history);
  });

  socket.on('clear-canvas', () => {
    if (!currentRoom) return;
    const state = getRoom(currentRoom);
    state.history = [];
    io.to(currentRoom).emit('clear-canvas');
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const state = rooms.get(currentRoom);
    if (state) {
      state.users.delete(socket.id);
      if (state.users.size === 0 && state.history.length === 0) {
        rooms.delete(currentRoom);
      }
    }
    socket.to(currentRoom).emit('user-left', { id: socket.id });
    io.to(currentRoom).emit('user-list', userList(currentRoom));
  });
});

server.listen(PORT, () => {
  console.log(`Inkwell whiteboard listening on http://localhost:${PORT}`);
});