'use strict';
// ─── Hungry Number Alligator ─────────────────────────────────────────────────
// Tap the BIGGER number and the alligator chomps it. (Request #6.)
// One tap per pair (via the shared round engine) — so a child can't tap the
// smaller one then "correct" it by tapping the other; first choice is what counts.
// Difficulty ramps with the streak. Observe-only multiplayer.
const path = require('path');
const roundGame = require('../_arcade');

module.exports = function createBigger({ base = '/bigger', io }) {
  function makeRound({ streak }) {
    const range = Math.min(9 + streak * 3, 99);
    let a = 1 + Math.floor(Math.random() * range), b = 1 + Math.floor(Math.random() * range);
    while (b === a) b = 1 + Math.floor(Math.random() * range);
    return { payload: { left: a, right: b }, correct: Math.max(a, b) };
  }
  return roundGame({ base, io, key: 'bigger', publicDir: path.join(__dirname, 'public'), makeRound, cooperative: false });
};
