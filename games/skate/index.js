'use strict';
// ─── Skate 'n' Add ───────────────────────────────────────────────────────────
// Skate into the star showing the correct sum. (Request #1, designed by Veronica.)
// Gameplay + problem/star generation run client-side, so every child's problems
// and stars are entirely their own — no player can touch another's. The server
// only relays skater positions, keeps an additive-only shared team score, and
// persists each player's own stats.
//
// Mountable module: createGame({ base, io }) → { router, io, getLive, broadcast, kickPlayer }
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');

const COLORS = ['#ff5aa5','#4ec3ff','#7be06a','#ffd23f','#b06bff','#ff8a3d','#40e0d0','#ff6b6b'];

module.exports = function createSkate({ base = '/skate', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));

  const rink = new Map();   // socketId -> { username, color, x, y, team }
  let teamScore = 0;
  const peers = () => Array.from(rink.entries()).map(([id, p]) => ({ id, username: p.username, color: p.color, x: p.x, y: p.y }));

  router.get('/api/my-stats', requireAuth, (req, res) => res.json({ stats: db.skateStats(req.player.id), facts: db.skateFacts(req.player.id) }));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    let joined = false;

    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true;
      rink.set(socket.id, { username: player.username, color, x: 450, y: 300, team: false });
      socket.emit('joined', { color, username: player.username, teamScore, peers: peers().filter(p => p.id !== socket.id) });
      socket.broadcast.emit('peerJoined', { id: socket.id, username: player.username, color, x: 450, y: 300 });
    });

    socket.on('pos', ({ x, y }) => {
      const me = rink.get(socket.id);
      if (!me) return;
      me.x = +x || 0; me.y = +y || 0;
      socket.broadcast.emit('peerPos', { id: socket.id, x: me.x, y: me.y });
    });

    socket.on('team', ({ on }) => { const me = rink.get(socket.id); if (me) me.team = !!on; });

    // The only channel that changes a player's learning state — and it only ever
    // affects THIS player's own stats (plus an additive team tally).
    socket.on('grab', ({ a, b, correct, streak }) => {
      if (!player) return;
      const av = Math.max(0, Math.min(9, a | 0)), bv = Math.max(0, Math.min(9, b | 0));
      db.skateRecord(player.id, av, bv, !!correct, streak | 0);
      if (correct) {
        const me = rink.get(socket.id);
        if (me && me.team) { teamScore++; io.emit('teamScore', { score: teamScore }); }
      }
    });

    socket.on('disconnect', () => {
      if (joined) { rink.delete(socket.id); socket.broadcast.emit('peerLeft', { id: socket.id }); }
    });
  });

  function getLive() {
    return { playing: rink.size, teamScore, players: Array.from(rink.values()).map(p => ({ username: p.username, team: p.team })) };
  }
  function kickPlayer(dbId, reason) {
    for (const [, s] of io.sockets.sockets) {
      const pl = playerFromSocket(s);
      if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); }
    }
  }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
