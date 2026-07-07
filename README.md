# Inkwell — Real-Time Collaborative Whiteboard

A multi-user whiteboard built with **Node.js, Express, and Socket.IO**. Everyone in the same room draws on the same canvas, live — you see each other's strokes and cursors appear instantly.

![tech](https://img.shields.io/badge/node-%3E%3D18-3654FF) ![tech](https://img.shields.io/badge/socket.io-4.x-FF6B4A)

## Features

- 🖊️ **Live shared drawing** — every stroke segment is broadcast over WebSockets and rendered on all connected clients in real time
- 🏷️ **Named rooms** — share a room code (`?room=your-code`) so only your group draws together
- 👀 **Live cursors** — see everyone else's pen position moving in real time, labeled with their name and color
- 🧑‍🤝‍🧑 **Presence bar** — avatar stack showing who's currently in the room
- 🎨 **Pen + eraser**, 8-color palette, adjustable brush size
- ↩️ **Per-user undo** — removes only your own last stroke for everyone
- 🧹 **Clear board** — wipes the canvas for the whole room
- 💾 **Export PNG** — download the current board as an image
- 🔄 **Late-join sync** — anyone who joins mid-session receives the full drawing history and sees the board exactly as it is
- 📱 Responsive layout, works with mouse, trackpad, touch, and stylus (Pointer Events)

## Tech stack

- **Backend:** Node.js, Express, Socket.IO (in-memory room + history store)
- **Frontend:** Vanilla JS + Canvas 2D API, no build step
- **Styling:** Hand-written CSS (Space Grotesk / Inter), no framework

## Project structure

```
inkwell-whiteboard/
├── server.js              # Express + Socket.IO server, room/history logic
├── package.json
└── public/
    ├── index.html          # App shell (join screen + board + toolbar)
    ├── css/style.css        # Visual design
    └── js/main.js            # Canvas drawing, socket events, UI logic
```

## Run it locally

```bash
git clone <your-repo-url>
cd inkwell-whiteboard
npm install
npm start
```

Then open **http://localhost:3000** in two different browser windows (or two tabs) to test collaboration — join the same room code in both.

For auto-restart on file changes during development:

```bash
npm run dev
```

## How the real-time sync works

1. On connect, a client emits `join-room` with a name and room code. The server assigns a color, adds the user to the room, and replies with the current user list + full drawing history so the new client can catch up instantly.
2. While drawing, the client emits small `draw-segment` events (`{x0,y0,x1,y1,color,size,tool,strokeId}`) using **coordinates normalized to 0–1**, so the board looks the same regardless of each user's screen size. The server appends the segment to that room's history and relays it to everyone else in the room.
3. Mouse/pen position is throttled and emitted as `cursor-move` so peers see a live, labeled cursor for each collaborator.
4. `clear-canvas` wipes a room's history and tells every client to clear their canvas. `undo-stroke` removes just the segments belonging to that stroke ID *and* that user, then broadcasts a full `redraw-all` so everyone stays in sync.
5. On disconnect, the user is removed from the room's presence list and their cursor disappears for everyone else.

## Deploying

This app needs a Node.js host that supports **persistent WebSocket connections** (not a static host). Good free/low-cost options:

### Render
1. Push this repo to GitHub.
2. On [render.com](https://render.com) → New → Web Service → connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Deploy. Render gives you a public `https://your-app.onrender.com` URL.

### Railway
1. Push this repo to GitHub.
2. On [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Railway auto-detects Node and runs `npm start`. Generate a public domain from the service settings.

### Fly.io / Heroku
Both work too — just make sure the start command is `npm start` and the app listens on `process.env.PORT` (already handled in `server.js`).

> No environment variables are required for a basic deployment.

### Split deployment: backend on Render, frontend on Vercel

Vercel's serverless functions historically couldn't hold a persistent Socket.IO connection, so the simplest reliable split is: **Render runs the always-on server, Vercel serves the static frontend.**

1. **Backend on Render:** deploy this repo as-is (see "Render" above). Note the URL Render gives you, e.g. `https://inkwell-backend.onrender.com`.
2. **Point the frontend at it:** open `public/js/main.js` and set:
   ```js
   const SOCKET_SERVER_URL = 'https://inkwell-backend.onrender.com';
   ```
3. **Frontend on Vercel:** create a new Vercel project from the same repo, and in the project settings set **Root Directory** to `public`. No build command is needed — Vercel will serve the static files directly. Deploy.
4. Open the Vercel URL — it will connect over WebSocket to your Render backend.

The Socket.IO client is already loaded from a CDN (`cdn.socket.io`) rather than from the server, so it works regardless of which host serves the page.

> Vercel has since added WebSocket support of its own (currently in public beta), but it doesn't keep in-memory state (like this app's room history) consistent across function instances without an external store like Redis. The Render+Vercel split above avoids that entirely with no extra infrastructure.

## Suggested demo flow (for your screen recording)

1. Open the deployed link in two separate browser windows side by side.
2. Join the same room code with two different names in each window.
3. Draw a shape in window A — show it appearing instantly in window B.
4. Move the mouse in window A without drawing — show the live labeled cursor moving in window B.
5. Switch colors/brush size, use the eraser, hit **Undo**, then **Clear** — show both windows staying in sync throughout.

## License

MIT — do whatever you'd like with this.