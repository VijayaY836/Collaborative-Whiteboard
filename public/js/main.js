(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const joinOverlay = document.getElementById('join-overlay');
  const nameInput = document.getElementById('name-input');
  const roomInput = document.getElementById('room-input');
  const newRoomBtn = document.getElementById('new-room-btn');
  const joinBtn = document.getElementById('join-btn');

  const appEl = document.getElementById('app');
  const roomLabel = document.getElementById('room-label');
  const roomPill = document.getElementById('room-pill');
  const connDot = document.getElementById('conn-dot');
  const presenceList = document.getElementById('presence-list');

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const cursorLayer = document.getElementById('cursor-layer');
  const toastEl = document.getElementById('toast');

  const swatchesEl = document.getElementById('swatches');
  const sizeRange = document.getElementById('size-range');
  const sizeLabel = document.getElementById('size-label');
  const undoBtn = document.getElementById('undo-btn');
  const clearBtn = document.getElementById('clear-btn');
  const saveBtn = document.getElementById('save-btn');
  const namesToggle = document.getElementById('names-toggle');
  const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');

  const PEN_COLORS = ['#161514', '#3654FF', '#FF6B4A', '#22C39E', '#B25CFF', '#F7B733', '#FF4F9A', '#0EA5C4'];
  const PAPER_COLOR = '#fdfcfa';

  // ---------------------------------------------------------------------
  // Backend connection
  // ---------------------------------------------------------------------
  // If the frontend is deployed separately from the Socket.IO server
  // (e.g. frontend on Vercel, backend on Render), set this to the
  // backend's URL. Leave it as '' to connect to whatever origin served
  // this page (use this when server.js also serves these static files).
  const SOCKET_SERVER_URL = 'https://inkwell-backend-i9ap.onrender.com/'; 

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let socket = null;
  let self = { id: null, name: '', color: '#3654FF' };
  let currentRoom = 'main';
  let activeTool = 'pen';
  let activeColor = PEN_COLORS[0];
  let activeSize = 6;

  let drawing = false;
  let currentStrokeId = null;
  let lastPoint = null; // {x, y} normalized 0..1
  let isFirstSegment = false; // marks the first segment of the current stroke
  let myStrokeStack = []; // stroke ids I've drawn, for undo
  let showNames = false; // toggle: label strokes with author name

  let clientHistory = []; // full replay log, kept in sync with server
  const remoteCursors = new Map(); // socketId -> {el, timeout}
  const remoteUsers = new Map(); // socketId -> {name, color}

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxxyxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function randomRoomCode() {
    const words = ['maple', 'quartz', 'ember', 'delta', 'harbor', 'violet', 'coast', 'lumen', 'ridge', 'cobalt'];
    const w = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(10 + Math.random() * 89);
    return `${w}-${n}`;
  }

  function showToast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
  }

  function contrastText(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? 'rgba(0,0,0,0.72)' : '#fff';
  }

  // ---------------------------------------------------------------------
  // Canvas sizing (device-pixel aware, fraction-based coordinates)
  // ---------------------------------------------------------------------
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    redrawAll(clientHistory);
  }

  function toPixels(nx, ny) {
    const rect = canvas.getBoundingClientRect();
    return { x: nx * rect.width, y: ny * rect.height };
  }

  function drawSegment(seg) {
    const p0 = toPixels(seg.x0, seg.y0);
    const p1 = toPixels(seg.x1, seg.y1);
    ctx.save();
    switch (seg.tool) {
      case 'eraser':
        ctx.strokeStyle = PAPER_COLOR;
        ctx.lineWidth = seg.size * 2.4;
        break;
      case 'highlighter':
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = seg.size * 2.2;
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = 'multiply';
        break;
      case 'brush':
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = seg.size * 1.4;
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = seg.size * 0.7;
        ctx.globalAlpha = 0.92;
        break;
      default: // pen
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = seg.size;
    }
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();

    if (showNames && seg.first && seg.authorName && seg.tool !== 'eraser') {
      drawAuthorLabel(seg.authorName, seg.authorColor || seg.color, p0);
    }
  }

  function drawShapeOp(shape) {
    const p0 = toPixels(shape.x0, shape.y0);
    const p1 = toPixels(shape.x1, shape.y1);
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (shape.shape === 'rectangle') {
      ctx.strokeRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
    } else if (shape.shape === 'circle') {
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      const rx = Math.max(Math.abs(p1.x - p0.x) / 2, 0.01);
      const ry = Math.max(Math.abs(p1.y - p0.y) / 2, 0.01);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else { // line
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();

    if (showNames && shape.authorName) {
      drawAuthorLabel(shape.authorName, shape.authorColor, p0);
    }
  }

  function drawTextOp(op) {
    const p = toPixels(op.x, op.y);
    ctx.save();
    ctx.fillStyle = op.color;
    ctx.font = `600 ${op.fontSize}px Inter, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(op.text, p.x, p.y);
    ctx.restore();

    if (showNames && op.authorName) {
      drawAuthorLabel(op.authorName, op.authorColor, { x: p.x, y: Math.max(0, p.y - 4) });
    }
  }

  function drawOp(op) {
    if (op.kind === 'shape') drawShapeOp(op);
    else if (op.kind === 'text') drawTextOp(op);
    else drawSegment(op);
  }

  function drawAuthorLabel(name, color, point) {
    ctx.save();
    ctx.font = "600 11px 'Space Grotesk', Inter, sans-serif";
    const paddingX = 7, paddingY = 4, boxH = 19;
    const textWidth = ctx.measureText(name).width;
    const boxW = textWidth + paddingX * 2;
    let bx = point.x + 8;
    let by = point.y - boxH - 8;
    const rect = canvas.getBoundingClientRect();
    if (bx + boxW > rect.width) bx = rect.width - boxW - 4;
    if (by < 4) by = point.y + 8;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 8) : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();

    ctx.fillStyle = contrastText(color);
    ctx.textBaseline = 'middle';
    ctx.fillText(name, bx + paddingX, by + boxH / 2 + 0.5);
    ctx.restore();
  }

  function redrawAll(history) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, rect.width, rect.height);
    history.forEach(drawOp);
  }


  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------------
  // Toolbar UI
  // ---------------------------------------------------------------------
  function buildSwatches() {
    swatchesEl.innerHTML = '';
    PEN_COLORS.forEach((color, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === 0 ? ' active' : '');
      b.style.background = color;
      b.type = 'button';
      b.title = color;
      b.addEventListener('click', () => {
        activeColor = color;
        setTool('pen');
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
      });
      swatchesEl.appendChild(b);
    });
  }

  function setTool(tool) {
    activeTool = tool;
    toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  }

  toolButtons.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

  sizeRange.addEventListener('input', () => {
    activeSize = Number(sizeRange.value);
    sizeLabel.textContent = `${activeSize}px`;
  });

  namesToggle.addEventListener('click', () => {
    showNames = !showNames;
    namesToggle.classList.toggle('active', showNames);
    redrawAll(clientHistory);
  });

  undoBtn.addEventListener('click', () => {
    const strokeId = myStrokeStack.pop();
    if (!strokeId || !socket) return;
    socket.emit('undo-stroke', strokeId);
  });

  clearBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('clear-canvas');
  });

  saveBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `inkwell-${currentRoom}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  roomPill.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(currentRoom)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied');
    } catch {
      showToast(url, 4000);
    }
  });

  // ---------------------------------------------------------------------
  // Presence UI
  // ---------------------------------------------------------------------
  function renderPresence(users) {
    presenceList.innerHTML = '';
    users.slice(0, 8).forEach(u => {
      const el = document.createElement('div');
      el.className = 'presence-avatar';
      el.style.background = u.color;
      el.dataset.name = u.id === self.id ? `${u.name} (you)` : u.name;
      el.innerHTML = `<span class="initial" style="color:${contrastText(u.color)}">${initials(u.name)}</span>`;
      presenceList.appendChild(el);
    });
  }

  function ensureRemoteCursor(id) {
    if (remoteCursors.has(id)) return remoteCursors.get(id);
    const user = remoteUsers.get(id);
    if (!user) return null;
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `<div class="nib" style="background:${user.color}"></div><div class="tag" style="background:${user.color}">${user.name}</div>`;
    cursorLayer.appendChild(el);
    const entry = { el };
    remoteCursors.set(id, entry);
    return entry;
  }

  function removeRemoteCursor(id) {
    const entry = remoteCursors.get(id);
    if (entry) {
      entry.el.remove();
      remoteCursors.delete(id);
    }
  }

  // ---------------------------------------------------------------------
  // Pointer drawing
  // ---------------------------------------------------------------------
  const SHAPE_TOOLS = new Set(['line', 'rectangle', 'circle']);
  let shapeStart = null; // normalized point where a shape drag began

  function normPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    };
  }

  function openTextEditor(e) {
    const p = normPoint(e);
    const px = toPixels(p.x, p.y);
    const fontSize = Math.max(14, activeSize * 3);

    const input = document.createElement('div');
    input.contentEditable = 'true';
    input.className = 'text-editor';
    input.style.left = `${px.x}px`;
    input.style.top = `${px.y}px`;
    input.style.color = activeColor;
    input.style.fontSize = `${fontSize}px`;
    cursorLayer.appendChild(input);
    input.focus();

    let settled = false;
    function commit() {
      if (settled) return;
      settled = true;
      const text = input.textContent.trim();
      input.remove();
      if (!text) return;
      const op = {
        kind: 'text', x: p.x, y: p.y, text,
        color: activeColor, fontSize,
        strokeId: uuid(), authorName: self.name, authorColor: self.color
      };
      myStrokeStack.push(op.strokeId);
      clientHistory.push(op);
      drawTextOp(op);
      if (socket) socket.emit('draw-text', op);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { settled = true; input.remove(); }
    });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (activeTool === 'text') {
      e.preventDefault(); // stop the browser from stealing focus back before we can type
      openTextEditor(e);
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    currentStrokeId = uuid();
    isFirstSegment = true;
    myStrokeStack.push(currentStrokeId);
    const p = normPoint(e);
    if (SHAPE_TOOLS.has(activeTool)) {
      shapeStart = p;
    } else {
      lastPoint = p;
    }
  });

  let lastCursorEmit = 0;
  canvas.addEventListener('pointermove', (e) => {
    const p = normPoint(e);

    // throttle cursor broadcasts to ~30/s
    const now = performance.now();
    if (socket && now - lastCursorEmit > 33) {
      lastCursorEmit = now;
      socket.emit('cursor-move', p);
    }

    if (!drawing) return;

    if (SHAPE_TOOLS.has(activeTool)) {
      if (!shapeStart) return;
      redrawAll(clientHistory);
      drawShapeOp({
        kind: 'shape', shape: activeTool,
        x0: shapeStart.x, y0: shapeStart.y, x1: p.x, y1: p.y,
        color: activeColor, size: activeSize,
        authorName: self.name, authorColor: self.color
      });
      return;
    }

    if (!lastPoint) return;
    const seg = {
      kind: 'segment',
      x0: lastPoint.x, y0: lastPoint.y,
      x1: p.x, y1: p.y,
      color: activeColor, size: activeSize,
      tool: activeTool, strokeId: currentStrokeId,
      first: isFirstSegment,
      authorName: self.name, authorColor: self.color
    };
    isFirstSegment = false;
    lastPoint = p;
    clientHistory.push(seg);
    drawSegment(seg);
    if (socket) socket.emit('draw-segment', seg);
  });

  function endStroke(e) {
    if (drawing && SHAPE_TOOLS.has(activeTool) && shapeStart && e) {
      const p = normPoint(e);
      const p0px = toPixels(shapeStart.x, shapeStart.y);
      const p1px = toPixels(p.x, p.y);
      const moved = Math.hypot(p1px.x - p0px.x, p1px.y - p0px.y) > 3;
      if (moved) {
        const shape = {
          kind: 'shape', shape: activeTool,
          x0: shapeStart.x, y0: shapeStart.y, x1: p.x, y1: p.y,
          color: activeColor, size: activeSize, strokeId: currentStrokeId,
          authorName: self.name, authorColor: self.color
        };
        clientHistory.push(shape);
        redrawAll(clientHistory);
        if (socket) socket.emit('draw-shape', shape);
      } else {
        redrawAll(clientHistory); // discard the abandoned preview
      }
    }
    drawing = false;
    lastPoint = null;
    shapeStart = null;
    currentStrokeId = null;
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointerleave', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // ---------------------------------------------------------------------
  // Join flow
  // ---------------------------------------------------------------------
  function prefillFromUrl() {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    roomInput.value = room || randomRoomCode();
    const savedName = localStorage.getItem('inkwell-name');
    if (savedName) nameInput.value = savedName;
  }

  newRoomBtn.addEventListener('click', () => { roomInput.value = randomRoomCode(); });

  function join() {
    const name = nameInput.value.trim() || 'Guest';
    const room = (roomInput.value.trim() || 'main').toLowerCase().replace(/\s+/g, '-');
    localStorage.setItem('inkwell-name', name);

    socket = SOCKET_SERVER_URL
      ? io(SOCKET_SERVER_URL, { transports: ['websocket', 'polling'] })
      : io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      connDot.classList.remove('offline');
      socket.emit('join-room', { room, name }, (payload) => {
        self = payload.self;
        currentRoom = room;
        roomLabel.textContent = room;

        history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);

        payload.users.forEach(u => remoteUsers.set(u.id, { name: u.name, color: u.color }));
        renderPresence(payload.users);

        clientHistory = payload.history || [];
        resizeCanvas(); // also triggers initial redraw

        joinOverlay.classList.add('hidden');
        appEl.classList.remove('hidden');
        resizeCanvas();
        showToast(`Welcome, ${self.name}`);
      });
    });

    socket.on('disconnect', () => connDot.classList.add('offline'));

    socket.on('user-joined', (u) => {
      remoteUsers.set(u.id, { name: u.name, color: u.color });
      showToast(`${u.name} joined the room`);
    });

    socket.on('user-left', (u) => {
      const user = remoteUsers.get(u.id);
      if (user) showToast(`${user.name} left`);
      remoteUsers.delete(u.id);
      removeRemoteCursor(u.id);
    });

    socket.on('user-list', (users) => renderPresence(users));

    socket.on('draw-segment', (seg) => {
      clientHistory.push(seg);
      drawSegment(seg);
    });

    socket.on('draw-shape', (shape) => {
      clientHistory.push(shape);
      drawShapeOp(shape);
    });

    socket.on('draw-text', (op) => {
      clientHistory.push(op);
      drawTextOp(op);
    });

    socket.on('redraw-all', (history) => {
      clientHistory = history;
      redrawAll(clientHistory);
    });

    socket.on('clear-canvas', () => {
      clientHistory = [];
      redrawAll(clientHistory);
      showToast('Board cleared');
    });

    socket.on('cursor-move', (data) => {
      const entry = ensureRemoteCursor(data.id);
      if (!entry) return;
      const px = toPixels(data.x, data.y);
      entry.el.style.transform = `translate(${px.x}px, ${px.y}px)`;
    });
  }

  joinBtn.addEventListener('click', join);
  [nameInput, roomInput].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  }));

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  buildSwatches();
  prefillFromUrl();
  sizeLabel.textContent = `${activeSize}px`;
})();