'use strict';
// ─── Typing Train ────────────────────────────────────────────────────────────
// A steam locomotive races a loop track; each correct keystroke advances it and
// typing speed sets the train's speed. Later levels type out stories. Gameplay
// (input, timing, animation) runs client-side for responsiveness; the server
// persists progress/stats, relays live peer positions, and serves ghost laps.
//
// Mountable module: createGame({ base, io }) → { router, io, getLive, broadcast, kickPlayer }
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');
const levels  = require('./levels');
const SEED_STORIES = require('./seedStories');

const PASS_ACCURACY = 0.9;    // min run accuracy to unlock the next level
const PASS_WPM      = 80;     // min run speed (wpm) to unlock the next level
const COLORS = ['#ffcc33','#44aaff','#ff5566','#44dd88','#cc66ff','#ff8844','#33d0d0','#ff77bb'];

module.exports = function createTypingTrain({ base = '/typing', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));

  // Seed built-in stories once.
  for (const s of SEED_STORIES) db.typSeedStory(s.title, s.author, s.source, s.grade, s.body);

  // ─── Live presence: level number → Map(socketId → peer) ─────────────────────
  const rooms = new Map();
  const roomOf = (lvl) => { if (!rooms.has(lvl)) rooms.set(lvl, new Map()); return rooms.get(lvl); };
  const peersInLevel = (lvl) => Array.from(roomOf(lvl).values()).map(p => ({ id: p.socketId, username: p.username, color: p.color, prog: p.prog, wpm: p.wpm }));

  // ─── REST ────────────────────────────────────────────────────────────────────
  router.get('/api/levels', (req, res) => res.json({
    finger: levels.FINGER,
    keyLevelCount: levels.KEY_LEVEL_COUNT,
    storyLevel: levels.STORY_LEVEL,
    list: Array.from({ length: levels.KEY_LEVEL_COUNT }, (_, i) => levels.levelInfo(i + 1)),
  }));

  router.get('/api/progress', requireAuth, (req, res) => {
    const pid = req.player.id;
    res.json({
      level:      db.typGetProgress(pid).level,
      keyStats:   db.typGetKeyStats(pid),
      recentLaps: db.typRecentLaps(pid),
    });
  });

  // Track layout + this player's ghost (their best lap) for a key level.
  router.get('/api/track', requireAuth, (req, res) => {
    const lvl = Number(req.query.level) || 1;
    const info = levels.levelInfo(lvl);
    if (!info) return res.status(404).json({ error: 'No such level' });
    const best = db.typBestLap(req.player.id, lvl);
    res.json({
      ...info,
      segmentsText: levels.trackForLevel(lvl),
      ghost: best ? { lapMs: best.lap_ms, splits: JSON.parse(best.splits || '[]') } : null,
      peers: peersInLevel(lvl),
    });
  });

  router.get('/api/stories', requireAuth, (req, res) => res.json(db.typActiveStories()));
  // Where the reader left off in a given story (paragraph index).
  router.get('/api/book/:storyId', requireAuth, (req, res) =>
    res.json({ paraIndex: db.typGetBookPos(req.player.id, Number(req.params.storyId)) }));
  router.get('/api/story/:id', requireAuth, (req, res) => {
    const s = db.typGetStory(Number(req.params.id));
    if (!s || !s.active) return res.status(404).json({ error: 'Not found' });
    res.json({ id: s.id, title: s.title, author: s.author, source: s.source, grade_level: s.grade_level, body: s.body });
  });

  // ─── Socket.io: presence relay + persistence ───────────────────────────────
  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    let curLevel = null;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    socket.on('join', ({ level }) => {
      if (!player) { socket.emit('authError'); return; }
      leave();
      curLevel = Number(level) || 1;
      const room = roomOf(curLevel);
      room.set(socket.id, { socketId: socket.id, username: player.username, color, prog: 0, wpm: 0 });
      socket.join('lvl:' + curLevel);
      socket.emit('joined', { color, username: player.username, level: curLevel, peers: peersInLevel(curLevel).filter(p => p.id !== socket.id) });
      socket.to('lvl:' + curLevel).emit('peerJoined', { id: socket.id, username: player.username, color, prog: 0, wpm: 0 });
    });

    socket.on('pos', ({ prog, wpm }) => {
      if (curLevel == null) return;
      const me = roomOf(curLevel).get(socket.id);
      if (!me) return;
      me.prog = +prog || 0; me.wpm = +wpm || 0;
      socket.to('lvl:' + curLevel).emit('peerPos', { id: socket.id, prog: me.prog, wpm: me.wpm });
    });

    // Lap / passage complete → persist stats, record lap, maybe unlock next level.
    socket.on('lap', ({ level, lapMs, splits, perKey, correct, incorrect, storyId, paraIndex, final, runWpm, runAcc }) => {
      if (!player) return;
      const lvl = Number(level) || curLevel || 1;
      // Persist the reader's position in the book (next paragraph to type).
      if (storyId && paraIndex != null) db.typSetBookPos(player.id, Number(storyId), Number(paraIndex));
      const corr = correct | 0, incorr = incorrect | 0;
      const total = corr + incorr;
      const accuracy = total ? corr / total : 0;
      const minutes = (lapMs || 1) / 60000;
      const wpm = minutes > 0 ? (corr / 5) / minutes : 0;

      if (perKey && typeof perKey === 'object') db.typRecordKeyStats(player.id, perKey);
      db.typRecordLap(player.id, lvl, storyId || null, lapMs || 0, wpm, accuracy, splits || []);

      // Unlock the next level only after a full 3-lap run that clears BOTH targets.
      let unlocked = db.typGetProgress(player.id).level;
      if (final && lvl <= levels.KEY_LEVEL_COUNT && lvl >= unlocked
          && (runAcc ?? 0) > PASS_ACCURACY && (runWpm ?? 0) > PASS_WPM) {
        unlocked = Math.min(lvl + 1, levels.STORY_LEVEL);
        db.typUnlockLevel(player.id, unlocked);
      }
      const best = db.typBestLap(player.id, lvl);
      socket.emit('lapSaved', {
        lapMs, wpm: Math.round(wpm), accuracy: Math.round(accuracy * 100),
        unlockedLevel: unlocked, passed: !!(final && unlocked > lvl),
        best: best ? { lapMs: best.lap_ms, wpm: Math.round(best.wpm || 0) } : null,
      });
    });

    function leave() {
      if (curLevel == null) return;
      const room = rooms.get(curLevel);
      if (room) { room.delete(socket.id); if (!room.size) rooms.delete(curLevel); }
      socket.to('lvl:' + curLevel).emit('peerLeft', { id: socket.id });
      socket.leave('lvl:' + curLevel);
      curLevel = null;
    }
    socket.on('disconnect', leave);
  });

  // ─── Teacher hooks ──────────────────────────────────────────────────────────
  function getLive() {
    const byLevel = {};
    for (const [lvl, room] of rooms) if (room.size) byLevel[lvl] = Array.from(room.values()).map(p => ({ username: p.username, wpm: p.wpm, prog: Math.round((p.prog||0)*100) }));
    return { levels: byLevel, playing: Array.from(rooms.values()).reduce((n, r) => n + r.size, 0) };
  }
  function kickPlayer(dbId, reason) {
    for (const room of rooms.values()) {
      for (const p of room.values()) {
        // presence keyed by socket; match by username is unreliable, so notify all sockets of this player id
      }
    }
    // Best-effort: notify every socket whose auth resolves to this player.
    for (const [, s] of io.sockets.sockets) {
      const pl = playerFromSocket(s);
      if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Account removed by teacher' }); s.disconnect(true); }
    }
  }

  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
