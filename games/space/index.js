'use strict';
// ─── Space Blaster Buddies ───────────────────────────────────────────────────
// Enemy ships fall showing a letter; press that letter to blast them. (Request #8.)
// Anti-mash: the client only lets you blast the NEAREST ship and by its exact
// letter — a wrong key is recorded as an error and blasts nothing, so mashing the
// keyboard tanks your accuracy instead of scoring. Cooperative team score.
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');
const COLORS = ['#9fd0ff','#c0c0c0','#a0ffa0','#ffd23f','#ff9db0','#c9a0ff'];

module.exports = function createSpace({ base = '/space', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));
  const rink = new Map();
  let teamScore = 0;
  const peers = () => Array.from(rink.entries()).map(([id, p]) => ({ id, username: p.username, color: p.color }));

  router.get('/api/my-stats', requireAuth, (req, res) => res.json(db.arcadeStats('space', req.player.id)));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    let joined = false, streak = 0;
    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true; rink.set(socket.id, { username: player.username, color });
      socket.emit('joined', { color, username: player.username, teamScore, peers: peers().filter(p => p.id !== socket.id) });
      socket.broadcast.emit('peerJoined', { id: socket.id, username: player.username, color });
    });
    // The client reports each keystroke as correct (matched the nearest ship's
    // letter) or not; a correct hit adds to the shared team score.
    socket.on('hit', ({ correct }) => {
      if (!player) return;
      if (correct) { streak++; db.arcadeRecord('space', player.id, true, streak); teamScore++; io.emit('teamScore', { score: teamScore }); }
      else { streak = 0; db.arcadeRecord('space', player.id, false, 0); }
    });
    socket.on('disconnect', () => { if (joined) { rink.delete(socket.id); socket.broadcast.emit('peerLeft', { id: socket.id }); } });
  });
  function getLive() { return { playing: rink.size, teamScore, players: Array.from(rink.values()).map(p => ({ username: p.username })) }; }
  function kickPlayer(dbId, reason) { for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } } }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
