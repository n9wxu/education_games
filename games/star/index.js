'use strict';
// ─── Star Captain: Race by the Stars ─────────────────────────────────────────
// v1 — the astronomy-recognition core (Request #20, by Dad). The captain learns
// the night sky: TRACE a constellation by connecting its stars in order, and NAME
// the highlighted stars. Star naming is server-graded (options shown, answer kept
// on the server). Observe-only friendly race with a leaderboard.
//
// PHASE 2 (needs go-ahead — a big sustained build): the virtual sextant, computing
// latitude/longitude from star tables + time, chart plotting, and dead reckoning.
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');
const CONST = require('./constellations');
const COLORS = ['#ffd23f','#9fd0ff','#7be06a','#ff9db0','#c9a0ff','#ffd0a0'];
const rand = n => Math.floor(Math.random() * n);
const shuffle = a => a.slice().sort(() => Math.random() - 0.5);
const allStarNames = CONST.flatMap(c => c.stars.map(s => s.name));

module.exports = function createStar({ base = '/star', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));
  const rink = new Map();   // socketId -> { username, color, score }
  const board = () => Array.from(rink.values()).map(p => ({ username: p.username, color: p.color, score: p.score })).sort((a, b) => b.score - a.score).slice(0, 8);

  router.get('/api/my-stats', requireAuth, (req, res) => res.json(db.arcadeStats('star', req.player.id)));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[rand(COLORS.length)];
    let joined = false, streak = 0, answer = null;

    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true; rink.set(socket.id, { username: player.username, color, score: 0 });
      socket.emit('joined', { color, username: player.username });
      io.emit('leaderboard', board());
      sendChallenge();
    });

    // Star positions/magnitudes only on the wire — never the star names, so the
    // "name" answer can't be read from the payload.
    const strip = c => ({ name: c.name, hint: c.hint, stars: c.stars.map(s => ({ x: s.x, y: s.y, mag: s.mag })), line: c.line });
    function sendChallenge() {
      const c = CONST[rand(CONST.length)];
      if (Math.random() < 0.5) {
        const si = rand(c.stars.length);
        const wrong = shuffle(allStarNames.filter(n => n !== c.stars[si].name)).slice(0, 3);
        answer = { type: 'name', name: c.stars[si].name };
        socket.emit('challenge', { type: 'name', c: strip(c), starIdx: si, options: shuffle([c.stars[si].name, ...wrong]) });
      } else {
        answer = { type: 'trace' };
        socket.emit('challenge', { type: 'trace', c: strip(c) });   // guided practice
      }
    }
    function grade(ok) {
      if (ok) { streak++; const me = rink.get(socket.id); if (me) me.score++; db.arcadeRecord('star', player.id, true, streak); }
      else { streak = 0; db.arcadeRecord('star', player.id, false, 0); }
      socket.emit('result', { correct: ok });
      io.emit('leaderboard', board());
    }
    socket.on('answer', ({ name }) => { if (!answer || answer.type !== 'name') return; const ok = name === answer.name; answer = null; grade(ok); });
    socket.on('traced', () => { if (!answer || answer.type !== 'trace') return; answer = null; grade(true); });  // guided completion
    socket.on('next', () => sendChallenge());
    socket.on('disconnect', () => { if (joined) { rink.delete(socket.id); io.emit('leaderboard', board()); } });
  });

  function getLive() { return { playing: rink.size, players: Array.from(rink.values()).map(p => ({ username: p.username, score: p.score })) }; }
  function kickPlayer(dbId, reason) { for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } } }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
