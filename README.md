# 🖋️ Inkwell — Real-Time Collaborative Whiteboard

A multi-user whiteboard where everyone in the same room draws on the same canvas, live. Strokes, shapes, text, and cursors all sync instantly over WebSockets — no page refresh, no save button, no accounts.

Built with **Node.js, Express, and Socket.IO** on the backend and **vanilla JavaScript + the Canvas 2D API** on the frontend — no build step, no framework, no bundler.

![tech](https://img.shields.io/badge/node-%3E%3D18-3654FF) ![tech](https://img.shields.io/badge/socket.io-4.x-FF6B4A) ![tech](https://img.shields.io/badge/frontend-vanilla%20JS-22C39E)

- 🎥 **Demo recording:** https://drive.google.com/file/d/1LK8_UBe8x0a8Yrfs7qkseBww_MkJ0jdP/view?usp=sharing

---

## What it does

Open the link, pick a name and a room code, and start drawing. Anyone else who opens the same room code — on any device, anywhere — sees your strokes appear in real time, sees your cursor move, and can draw right alongside you.

## Features

| | |
|---|---|
| 🖊️ **Live shared drawing** | Every stroke is broadcast over WebSockets and rendered on all connected clients as it happens |
| 🖌️ **Six drawing tools** | Pen, brush (soft glow), highlighter (translucent marker), eraser, and shape tools (line, rectangle, circle) |
| 🔤 **Text tool** | Click anywhere to drop editable text in your chosen color |
| 🏷️ **Named rooms** | Share a room code (`?room=your-code`) so only your group draws together |
| 👀 **Live cursors** | See everyone else's pointer moving in real time, labeled with their name and color |
| 🧑‍🤝‍🧑 **Presence bar** | Avatar stack showing who's currently in the room |
| 🪧 **"Show names" toggle** | Label every stroke on the board with who drew it |
| ↩️ **Per-user undo** | Removes only your own last action, for everyone |
| 🧹 **Clear board** | Wipes the canvas for the whole room |
| 💾 **Export PNG** | Download the current board as an image |
| 🔄 **Late-join sync** | Anyone who joins mid-session gets the full drawing history and sees the board exactly as it is |
| 📱 **Responsive & multi-input** | Works with mouse, trackpad, touch, and stylus via the Pointer Events API |

## Tech stack

- **Backend:** Node.js, Express, Socket.IO — in-memory per-room state (users, colors, drawing history)
- **Frontend:** Vanilla JavaScript, HTML5 Canvas 2D — no React, no build tooling
- **Styling:** Hand-written CSS (Space Grotesk + Inter), no framework

## Project structure

```
inkwell-whiteboard/
├── server.js              # Express + Socket.IO server: rooms, presence, drawing history
├── package.json
├── .gitignore
└── public/
    ├── index.html          # App shell: join screen, canvas, toolbar
    ├── css/
    │   └── style.css        # Visual design (dark app chrome, light join screen)
    └── js/
        └── main.js            # Canvas rendering, socket events, tool logic, UI
```

## Getting started

Requires Node.js 18+.

```bash
git clone https://github.com/VijayaY836/Collaborative-Whiteboard
cd inkwell-whiteboard
npm install
npm start
```

Open **http://localhost:3000** in two browser windows (or tabs) — join the same room code in both — to see collaboration in action.

For auto-restart on file changes during development:

```bash
npm run dev
```

No environment variables or `.env` file are required for local use — the server defaults to port `3000`, or whatever `PORT` your host provides.

## How the real-time sync works

1. **Joining a room** — a client emits `join-room` with a name and room code. The server assigns a color from an 8-color palette, adds the user to that room, and replies with the current user list and the full drawing history, so a new client can catch up instantly.
2. **Drawing** — freehand tools (pen, brush, highlighter, eraser) emit small `draw-segment` events as the pointer moves; shape tools (line, rectangle, circle) emit a single `draw-shape` event on release, after a local drag preview; the text tool emits one `draw-text` event on commit. All three op types carry **coordinates normalized to 0–1**, so the board looks the same regardless of each user's screen size.
3. **Relaying** — the server tags each incoming op with the sender's socket ID, appends it to that room's history array, and relays it to everyone else in the room.
4. **Cursors** — pointer position is throttled (~30/s) and broadcast as `cursor-move`, rendered as a labeled, colored cursor for each collaborator.
5. **Undo & clear** — `undo-stroke` removes only the ops belonging to that stroke ID *and* that user from the room's history, then broadcasts a full `redraw-all` so everyone stays in sync. `clear-canvas` wipes a room's history entirely.
6. **Leaving** — on disconnect, the user is dropped from the room's presence list and their cursor disappears for everyone else.

## Using the app

1. Enter a name and a room code (or click **New** for a random one), then **Enter the room**.
2. Pick a tool from the floating toolbar: **pen, brush, highlighter, eraser, line, rectangle, circle, text**.
3. Choose a color and brush size.
4. Draw. Click the room pill at the top to copy an invite link for others.
5. Toggle **show names** to label strokes with their author.
6. **Undo** removes only your own last action; **Clear** wipes the board for everyone; **Save** downloads a PNG.

## License

MIT — do whatever you'd like with this.
