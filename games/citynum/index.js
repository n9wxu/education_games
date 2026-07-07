'use strict';
// ─── City Number Blaster ─────────────────────────────────────────────────────
// A target number is shown; blast the enemy holding THAT number (1–80). (Request #11.)
// One shot per round (shared engine) → can't brute-force every enemy. Observe-only.
const path = require('path');
const roundGame = require('../_arcade');

module.exports = function createCityNum({ base = '/citynum', io }) {
  function makeRound({ streak }) {
    const target = 1 + Math.floor(Math.random() * 80);
    const set = new Set([target]);
    const n = Math.min(4 + Math.floor(streak / 4), 6);
    while (set.size < n) set.add(1 + Math.floor(Math.random() * 80));
    const enemies = [...set].sort(() => Math.random() - 0.5);
    return { payload: { target, enemies }, correct: target };
  }
  return roundGame({ base, io, key: 'citynum', publicDir: path.join(__dirname, 'public'), makeRound, cooperative: false });
};
