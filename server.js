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
// Load a gitignored .env (for ANTHROPIC_API_KEY etc.) if present — best effort.
try { require('process').loadEnvFile(require('path').join(__dirname, '.env')); } catch (e) {}

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
  { key: 'typing',   base: '/typing',   title: 'Typing Train',      factory: require('./games/typing-train') },
  { key: 'skate',    base: '/skate',    title: "Skate 'n' Add",     factory: require('./games/skate') },
  { key: 'read',     base: '/read',     title: 'Rocket Read',       factory: require('./games/read') },
  { key: 'bigger',   base: '/bigger',   title: 'Hungry Number Alligator', factory: require('./games/bigger') },
  { key: 'citynum',  base: '/citynum',  title: 'City Number Blaster',     factory: require('./games/citynum') },
  { key: 'tank',     base: '/tank',     title: 'Tank Squad Math Blast',   factory: require('./games/tank') },
  { key: 'space',    base: '/space',    title: 'Space Blaster Buddies',   factory: require('./games/space') },
  { key: 'art',      base: '/art',      title: 'Silly Art Party!',        factory: require('./games/art') },
  { key: 'rockite',  base: '/rockite',  title: 'Rockite Tank Blaster',    factory: require('./games/rockite') },
  { key: 'star',     base: '/star',     title: 'Star Captain',            factory: require('./games/star') },
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

// ─── Game Wizard (kids design new games with an AI helper) ────────────────────
app.use('/wizard', express.json(), authRouter);          // shared login/register/me
app.use('/wizard', require('./wizard')().router);

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
