'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Family Games — single unified server on ONE port.
//   /                selector menu
//   /math            Math Gator
//   /spelling        Spelling Invaders
//   /sniper          Spelling Sniper
//   /teacher         unified teacher interface (shared password)
// Each game gets its own Socket.IO instance bound to `${base}/socket.io` so the
// three games coexist on one port without colliding.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');
const auth    = require('./shared/auth');

const app    = express();
const server = http.createServer(app);

// ─── Games registry ───────────────────────────────────────────────────────────
const GAMES = [
  { key: 'math',     base: '/math',     title: 'Math Gator',        factory: require('./games/math') },
  { key: 'spelling', base: '/spelling', title: 'Spelling Invaders', factory: require('./games/spelling-invaders') },
  { key: 'sniper',   base: '/sniper',   title: 'Spelling Sniper',   factory: require('./games/spelling-sniper') },
];

const mounted = {};   // key -> { router, io, kickPlayer, pushFocus, ... }
const authRouter = auth.router();

for (const g of GAMES) {
  const io   = new Server(server, { path: `${g.base}/socket.io` });
  const inst = g.factory({ base: g.base, io });
  mounted[g.key] = inst;
  // shared auth (login/register/logout/me) under each game's base, then game router
  app.use(g.base, express.json(), authRouter);
  app.use(g.base, inst.router);
  console.log(`Mounted ${g.title} at ${g.base} (socket ${g.base}/socket.io)`);
}

// ─── Unified teacher interface ────────────────────────────────────────────────
app.use('/teacher', require('./portal/teacher')(mounted));

// ─── Selector menu + static portal assets ─────────────────────────────────────
app.use(express.static(path.join(__dirname, 'portal', 'public')));

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nFamily Games on http://localhost:${PORT}`);
  console.log(`Teacher:  http://localhost:${PORT}/teacher\n`);
});
