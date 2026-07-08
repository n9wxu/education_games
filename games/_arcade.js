'use strict';
// Shared engine for "identify the correct target" games (Hungry Alligator, City
// Number Blaster, Tank Squad). The game supplies makeRound() → { payload, correct };
// this handles auth, per-player round state, GRADING, stats, peer relay, and the
// optional cooperative team score.
//
// Anti-cheat is built in: exactly ONE answer counts per round (a wrong answer ends
// the round and is recorded incorrect), so a child cannot brute-force every option.
const express = require('express');
const db      = require('../shared/db');
const { requireAuth, playerFromSocket } = require('../shared/auth');

const COLORS = ['#ffd23f','#4ec3ff','#7be06a','#ff5aa5','#b06bff','#ff8a3d','#40e0d0','#ff6b6b'];

module.exports = function roundGame({ base, io, key, publicDir, makeRound, cooperative = false, cheers = null }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(publicDir));

  const rink = new Map();     // socketId -> { username, color, score, streak }
  const rounds = new Map();   // socketId -> { correct }
  let teamScore = 0;
  const peers = () => Array.from(rink.entries()).map(([id, p]) => ({ id, username: p.username, color: p.color, score: p.score }));

  router.get('/api/my-stats', requireAuth, (req, res) => res.json(db.arcadeStats(key, req.player.id)));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    let joined = false;

    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true;
      rink.set(socket.id, { username: player.username, color, score: 0, streak: 0 });
      socket.emit('joined', { color, username: player.username, cooperative, teamScore, cheers, peers: peers().filter(p => p.id !== socket.id) });
      socket.broadcast.emit('peerJoined', { id: socket.id, username: player.username, color, score: 0 });
    });

    socket.on('newRound', () => {
      const me = rink.get(socket.id); if (!me) return;
      const r = makeRound({ streak: me.streak });    // difficulty can ramp with streak
      rounds.set(socket.id, { correct: r.correct });
      socket.emit('round', r.payload);
    });

    // One graded answer per round — the correct value is kept on the server.
    socket.on('answer', ({ choice }) => {
      if (!player) return;
      const r = rounds.get(socket.id); if (!r) return;
      rounds.delete(socket.id);
      const ok = Number(choice) === Number(r.correct);
      const me = rink.get(socket.id);
      if (ok) { if (me) { me.score++; me.streak++; } db.arcadeRecord(key, player.id, true, me ? me.streak : 1);
                if (cooperative) { teamScore++; io.emit('teamScore', { score: teamScore }); } }
      else    { if (me) me.streak = 0; db.arcadeRecord(key, player.id, false, 0); }
      socket.emit('result', { correct: ok, answer: r.correct });
      if (me) socket.broadcast.emit('peerScore', { id: socket.id, score: me.score });
    });

    // Preset friendly cheers only (no free text) — relayed to other players.
    if (cheers) socket.on('cheer', ({ msg }) => {
      const me = rink.get(socket.id);
      if (me && cheers.includes(msg)) socket.broadcast.emit('peerCheer', { username: me.username, msg });
    });

    socket.on('disconnect', () => { if (joined) { rink.delete(socket.id); rounds.delete(socket.id); socket.broadcast.emit('peerLeft', { id: socket.id }); } });
  });

  function getLive() { return { playing: rink.size, teamScore: cooperative ? teamScore : undefined, players: Array.from(rink.values()).map(p => ({ username: p.username, score: p.score })) }; }
  function kickPlayer(dbId, reason) { for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } } }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
