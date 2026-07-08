'use strict';
// ─── Rockite Tank Blaster ────────────────────────────────────────────────────
// A number 1–20 is called out (spoken + shown); blast the enemy tank showing that
// number. (Request #2, by yuo.) One shot per call (shared engine) → no brute-force.
// Observe-only with preset friendly cheers (no free text).
const path = require('path');
const roundGame = require('../_arcade');

module.exports = function createRockite({ base = '/rockite', io }) {
  function makeRound({ streak }) {
    const target = 1 + Math.floor(Math.random() * 20);
    const set = new Set([target]);
    const n = Math.min(3 + Math.floor(streak / 5), 5);
    while (set.size < n) set.add(1 + Math.floor(Math.random() * 20));
    return { payload: { target, tanks: [...set].sort(() => Math.random() - 0.5) }, correct: target };
  }
  return roundGame({
    base, io, key: 'rockite', publicDir: path.join(__dirname, 'public'), makeRound,
    cooperative: false, cheers: ['Good job! 👍', 'Nice shot! 💥', "Let's go! 🚀"],
  });
};
