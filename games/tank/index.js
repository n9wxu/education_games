'use strict';
// ─── Tank Squad Math Blast ───────────────────────────────────────────────────
// A math problem shows; shoot the tank carrying the correct answer. (Request #10.)
// One shot per problem (shared engine) → can't brute-force all tanks. Cooperative
// team score. Addition/subtraction within 20 and single-digit multiplication.
const path = require('path');
const roundGame = require('../_arcade');
const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

module.exports = function createTank({ base = '/tank', io }) {
  function makeRound() {
    const op = ['+', '-', '×'][ri(0, 2)];
    let a, b, ans;
    if (op === '+')      { a = ri(1, 10); b = ri(0, Math.min(10, 20 - a)); ans = a + b; }
    else if (op === '-') { a = ri(2, 20); b = ri(0, a);                    ans = a - b; }
    else                 { a = ri(2, 9);  b = ri(2, 9);                    ans = a * b; }
    const set = new Set([ans]);
    for (const o of [-3,-2,-1,1,2,3,4,5].sort(() => Math.random() - 0.5)) { if (set.size >= 4) break; if (ans + o >= 0) set.add(ans + o); }
    while (set.size < 4) set.add(ans + ri(1, 9));
    return { payload: { problem: `${a} ${op} ${b}`, tanks: [...set].sort(() => Math.random() - 0.5) }, correct: ans };
  }
  return roundGame({ base, io, key: 'tank', publicDir: path.join(__dirname, 'public'), makeRound, cooperative: true });
};
