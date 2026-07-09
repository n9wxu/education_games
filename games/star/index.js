'use strict';
// ─── Star Captain: Race by the Stars ─────────────────────────────────────────
// v2 — teach then reinforce, with difficulty that scales as the learner improves.
// (Request #20, by Dad. Feedback: add a tutorial per level; drop the clumsy
// "draw over the constellation" trace; start pre-drawn with multiple choice, then
// fade the drawing as skill develops, and finally a realistic sky where the
// constellation blends into the other stars; subtle real star colours.)
//
// Flow per constellation: a TUTORIAL first (labelled, exaggerated, teaches the
// star names + colours), then multiple-choice reinforcement (name the glowing
// star / name the constellation). All graded on the server; star/constellation
// names being asked for are never sent on the wire. Difficulty tier comes from
// the learner's own accumulated correct answers:
//   tier 0  bright drawn lines + labels-off  (beginner)
//   tier 1  faded lines                      (developing)
//   tier 2  realistic dense star field, no lines — the figure blends in (skilled)
// The background field is seeded per round (randomised) so it can't be memorised.
//
// PHASE 2 (pending go-ahead): virtual sextant, latitude/longitude from star tables
// + time, chart plotting, dead reckoning. And optional real public-domain photos
// for the top tier (the procedural realistic field currently fills that role).
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth, playerFromSocket } = require('../../shared/auth');
const CONST = require('./constellations');
const COLORS = ['#ffd23f','#9fd0ff','#7be06a','#ff9db0','#c9a0ff','#ffd0a0'];
const rand = n => Math.floor(Math.random() * n);
const shuffle = a => a.slice().sort(() => Math.random() - 0.5);
const allStarNames = CONST.flatMap(c => c.stars.map(s => s.name));
const allConstNames = CONST.map(c => c.name);

module.exports = function createStar({ base = '/star', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));
  const rink = new Map();   // socketId -> { username, color, score }
  const board = () => Array.from(rink.values()).map(p => ({ username: p.username, color: p.color, score: p.score })).sort((a, b) => b.score - a.score).slice(0, 8);
  const tierFor = pid => { const c = (db.arcadeStats('star', pid) || {}).correct || 0; return c < 6 ? 0 : c < 16 ? 1 : 2; };

  router.get('/api/my-stats', requireAuth, (req, res) => res.json(db.arcadeStats('star', req.player.id)));

  io.on('connection', socket => {
    const player = playerFromSocket(socket);
    const color = COLORS[rand(COLORS.length)];
    let joined = false, streak = 0, answer = null;
    const seen = new Set();

    socket.on('join', () => {
      if (!player) { socket.emit('authError'); return; }
      joined = true; rink.set(socket.id, { username: player.username, color, score: 0 });
      socket.emit('joined', { color, username: player.username });
      io.emit('leaderboard', board());
      sendChallenge();
    });

    // stars for the wire: positions/magnitudes/colours only — never the name being asked for
    const stripStars = c => c.stars.map(s => ({ x: s.x, y: s.y, mag: s.mag, color: s.color }));

    function sendChallenge() {
      const c = CONST[rand(CONST.length)];
      if (!seen.has(c.name)) {            // teach this constellation before quizzing it
        seen.add(c.name); answer = { type: 'tutorial' };
        socket.emit('challenge', { type: 'tutorial', c: { name: c.name, hint: c.hint, stars: c.stars, line: c.line } });
        return;
      }
      const tier = tierFor(player.id), seed = (Math.random() * 1e9) | 0;
      if (Math.random() < 0.5) {          // name the glowing star
        const si = rand(c.stars.length);
        const wrong = shuffle(allStarNames.filter(n => n !== c.stars[si].name)).slice(0, 3);
        answer = { type: 'name', name: c.stars[si].name };
        socket.emit('challenge', { type: 'name-star', tier, seed, name: c.name, stars: stripStars(c), line: c.line, starIdx: si, options: shuffle([c.stars[si].name, ...wrong]) });
      } else {                            // name the constellation (name withheld)
        const wrong = shuffle(allConstNames.filter(n => n !== c.name)).slice(0, 3);
        answer = { type: 'name', name: c.name };
        socket.emit('challenge', { type: 'name-constellation', tier, seed, stars: stripStars(c), line: c.line, options: shuffle([c.name, ...wrong]) });
      }
    }
    function grade(ok) {
      if (ok) { streak++; const me = rink.get(socket.id); if (me) me.score++; db.arcadeRecord('star', player.id, true, streak); }
      else { streak = 0; db.arcadeRecord('star', player.id, false, 0); }
      socket.emit('result', { correct: ok, answer: answer && answer.name });
      answer = null;
      io.emit('leaderboard', board());
    }
    socket.on('answer', ({ name }) => { if (!answer || answer.type !== 'name') return; grade(name === answer.name); });
    socket.on('next', () => sendChallenge());   // tutorial → next; result → next
    socket.on('disconnect', () => { if (joined) { rink.delete(socket.id); io.emit('leaderboard', board()); } });
  });

  function getLive() { return { playing: rink.size, players: Array.from(rink.values()).map(p => ({ username: p.username, score: p.score })) }; }
  function kickPlayer(dbId, reason) { for (const [, s] of io.sockets.sockets) { const pl = playerFromSocket(s); if (pl && pl.id === dbId) { s.emit('kicked', { reason: reason || 'Removed by teacher' }); s.disconnect(true); } } }
  return { router, io, getLive, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
