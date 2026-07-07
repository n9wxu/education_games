'use strict';
// ─── Rocket Read ─────────────────────────────────────────────────────────────
// Read a sentence (shown only briefly), then it reappears with one word blanked —
// type the missing word to blast your rocket up. (Request #15, designed by yuo.)
//
// Rounds are generated AND graded on the server: the client is shown the sentence
// and which word is blanked, but NEVER the answer — so there is no word to copy,
// and grading can't be faked. Reading material is the shared Typing Train story
// library (public-domain youth classics from Project Gutenberg). Observe-only rocket
// race: each child reads their own sentences; peers' rockets are visible only.
//
// Mountable module: createGame({ base, io }) → { router, io, getLive, broadcast, kickPlayer }
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');

const COLORS = ['#ffd23f','#4ec3ff','#7be06a','#ff5aa5','#b06bff','#ff8a3d','#40e0d0','#ff6b6b'];
const STOP = new Set(('the a an and or but of to in on at for with as is are was were be been being it its it\'s this that these those he she they them his her their you your i we our my me him them from by not so if then than there here what when where who whom which will would can could should had has have do does did are'.split(' ')));
const FALLBACK = [
  'The little train puffed bravely up the steep green hill.',
  'A curious rabbit hopped quietly across the sunny meadow.',
  'The brave sailor steered his ship through the stormy waves.',
  'Golden stars twinkled softly above the sleeping village.',
];

const clean = w => w.replace(/[^A-Za-z']/g, '');
const norm  = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = function createRead({ base = '/read', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));

  const rink = new Map();   // socketId -> { username, color, height, streak }
  const rounds = new Map(); // socketId -> { answer }
  const peers = () => Array.from(rink.entries()).map(([id, p]) => ({ id, username: p.username, color: p.color, height: p.height }));

  // ── Round generation from the shared story corpus ───────────────────────────
  function sentencePool() {
    const out = [];
    for (const s of db.typActiveStories()) {
      const story = db.typGetStory(s.id);
      if (!story) continue;
      for (const raw of story.body.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
        const words = raw.trim().split(' ').filter(Boolean);
        if (words.length >= 6 && words.length <= 16 && targetIndex(words) >= 0) out.push(words);
      }
    }
    if (!out.length) for (const f of FALLBACK) out.push(f.split(' '));
    return out;
  }
  function targetIndex(words) {
    const cand = [];
    for (let i = 1; i < words.length - 1; i++) { const c = clean(words[i]); if (c.length >= 4 && !STOP.has(c.toLowerCase())) cand.push(i); }
    return cand.length ? cand[Math.floor(Math.random() * cand.length)] : -1;
  }
  const pool = sentencePool();
  function makeRound() {
    const words = pool[Math.floor(Math.random() * pool.length)];
    let bi = targetIndex(words);
    if (bi < 0) bi = Math.floor(words.length / 2);
    const answer = norm(words[bi]);
    const displayMs = Math.max(2500, Math.min(8000, 1500 + words.length * 320));
    return { words, blankIndex: bi, answer, displayMs };
  }

  router.get('/api/my-stats', requireAuth, (req, res) => res.json(db.readingStats(req.player.id)));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    let joined = false;

    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true;
      rink.set(socket.id, { username: player.username, color, height: 0, streak: 0 });
      socket.emit('joined', { color, username: player.username, peers: peers().filter(p => p.id !== socket.id) });
      socket.broadcast.emit('peerJoined', { id: socket.id, username: player.username, color, height: 0 });
    });

    socket.on('newRound', () => {
      if (!rink.has(socket.id)) return;
      const r = makeRound();
      rounds.set(socket.id, { answer: r.answer });
      socket.emit('round', { words: r.words, blankIndex: r.blankIndex, displayMs: r.displayMs });
    });

    // Server-graded — the client never had the answer, so it can't cheat the check.
    socket.on('answer', ({ guess }) => {
      if (!player) return;
      const r = rounds.get(socket.id); if (!r) return;
      rounds.delete(socket.id);
      const correct = norm(guess) === r.answer && r.answer.length > 0;
      const me = rink.get(socket.id);
      if (correct) { if (me) { me.streak++; me.height++; } db.readingRecord(player.id, true, me ? me.streak : 1); }
      else         { if (me) me.streak = 0;                db.readingRecord(player.id, false, 0); }
      socket.emit('result', { correct, answer: r.answer });
      if (correct && me) socket.broadcast.emit('peerHeight', { id: socket.id, height: me.height });
    });

    socket.on('disconnect', () => { if (joined) { rink.delete(socket.id); rounds.delete(socket.id); socket.broadcast.emit('peerLeft', { id: socket.id }); } });
  });

  function getLive() { return { playing: rink.size, players: Array.from(rink.values()).map(p => ({ username: p.username, height: p.height })) }; }
  function kickPlayer(dbId, reason) {
    for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } }
  }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
