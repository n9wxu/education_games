'use strict';
// ─── Silly Art Party! ────────────────────────────────────────────────────────
// Everyone gets the same silly prompt, draws it on their OWN canvas in a timed
// round, then gives each other positive-only stickers. (Request #7, by Veronica.)
// No score to game — it's creative expression; the only interaction is adding
// happy stickers to others' art (no negatives, no ranking), so no child can
// disrupt or discourage another. Each canvas is private until submitted.
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');

const ROUND_MS = 75000;
const PROMPTS = [
  'a dancing banana', 'a cat wearing a party hat', 'a robot eating spaghetti',
  'a happy cloud raining hearts', 'a dog on a skateboard', 'a sun with sunglasses',
  'a dinosaur at a tea party', 'a flying pizza', 'a penguin in a cozy scarf',
  'a monster made of jelly', 'a rocket with a smiley face', 'a fish riding a bicycle',
  'a giraffe with a long silly tie', 'a snail racing a turtle', 'a cupcake superhero',
];
const pick = a => a[Math.floor(Math.random() * a.length)];

module.exports = function createArt({ base = '/art', io }) {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use(express.static(path.join(__dirname, 'public')));

  let prompt = { text: pick(PROMPTS), endsAt: Date.now() + ROUND_MS };
  const gallery = [];      // { id, username, img, stickers:{star,rainbow} } — recent, capped
  const rink = new Map();
  let nextArt = 1;

  setInterval(() => { prompt = { text: pick(PROMPTS), endsAt: Date.now() + ROUND_MS }; gallery.length = 0; io.emit('prompt', prompt); }, ROUND_MS);

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    let joined = false;
    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true; rink.set(socket.id, { username: player.username });
      socket.emit('joined', { username: player.username, prompt, gallery });
    });
    socket.on('submit', ({ img }) => {
      if (!player || typeof img !== 'string' || img.length > 400000) return;
      const art = { id: nextArt++, username: player.username, img, stickers: { star: 0, rainbow: 0 } };
      gallery.push(art); if (gallery.length > 16) gallery.shift();
      db.arcadeRecord('art', player.id, true, 0);       // a finished drawing = participation
      io.emit('artwork', { id: art.id, username: art.username, img: art.img });
    });
    socket.on('sticker', ({ artId, kind }) => {
      if (kind !== 'star' && kind !== 'rainbow') return;   // positive only
      const art = gallery.find(a => a.id === Number(artId)); if (!art) return;
      art.stickers[kind]++; io.emit('sticker', { artId: art.id, kind, count: art.stickers[kind] });
    });
    socket.on('disconnect', () => { if (joined) rink.delete(socket.id); });
  });

  function getLive() { return { playing: rink.size, prompt: prompt.text, players: Array.from(rink.values()).map(p => ({ username: p.username })) }; }
  function kickPlayer(dbId, reason) { for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } } }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
