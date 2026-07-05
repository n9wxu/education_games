'use strict';
// Typing Train curriculum. Shared by the server (validation, track generation,
// "keys learned?" check) and sent to the client (rendering, finger guidance).

// QWERTY finger assignments — which finger presses each key.
const FINGER = {
  '`':'Lpinky','1':'Lpinky','q':'Lpinky','a':'Lpinky','z':'Lpinky',
  '2':'Lring','w':'Lring','s':'Lring','x':'Lring',
  '3':'Lmid','e':'Lmid','d':'Lmid','c':'Lmid',
  '4':'Lindex','5':'Lindex','r':'Lindex','t':'Lindex','f':'Lindex','g':'Lindex','v':'Lindex','b':'Lindex',
  '6':'Rindex','7':'Rindex','y':'Rindex','u':'Rindex','h':'Rindex','j':'Rindex','n':'Rindex','m':'Rindex',
  '8':'Rmid','i':'Rmid','k':'Rmid',',':'Rmid',
  '9':'Rring','o':'Rring','l':'Rring','.':'Rring',
  '0':'Rpinky','-':'Rpinky','=':'Rpinky','p':'Rpinky',';':'Rpinky',"'":'Rpinky','/':'Rpinky','[':'Rpinky',']':'Rpinky',
  ' ':'Thumb',
};

// Ordered curriculum. `keys` = the pool of characters that appear on this level's
// track; `newKeys` = keys introduced here (highlighted in the finger guide).
const KEY_LEVELS = [
  { name: 'Home Row: F J',      keys: ['f','j'],                              newKeys: ['f','j'] },
  { name: 'Home Row: D K',      keys: ['f','j','d','k'],                      newKeys: ['d','k'] },
  { name: 'Home Row: S L',      keys: ['f','j','d','k','s','l'],              newKeys: ['s','l'] },
  { name: 'Home Row: A ;',      keys: ['f','j','d','k','s','l','a',';'],      newKeys: ['a',';'] },
  { name: 'Home Row: G H',      keys: ['a','s','d','f','g','h','j','k','l',';'], newKeys: ['g','h'] },
  { name: 'Top Reach: E I',     keys: ['a','s','d','f','j','k','l',';','e','i'], newKeys: ['e','i'] },
  { name: 'Top Reach: R U',     keys: ['a','s','d','f','j','k','l',';','e','i','r','u'], newKeys: ['r','u'] },
  { name: 'Top Row: W O T Y',   keys: ['a','s','d','f','j','k','l',';','e','i','r','u','w','o','t','y'], newKeys: ['w','o','t','y'] },
  { name: 'Top Row: Q P',       keys: ['q','w','e','r','t','y','u','i','o','p'], newKeys: ['q','p'] },
  { name: 'Bottom Row: V M C',  keys: ['a','s','d','f','j','k','l','v','m','c'], newKeys: ['v','m','c'] },
  { name: 'Bottom Row: X Z B N',keys: ['a','s','d','f','j','k','l','x','z','b','n','v','m','c'], newKeys: ['x','z','b','n'] },
  { name: 'Numbers: Home',      keys: ['4','5','6','7','f','j','d','k'],       newKeys: ['4','5','6','7'] },
  { name: 'Numbers: All',       keys: ['1','2','3','4','5','6','7','8','9','0'], newKeys: ['1','2','3','8','9','0'] },
  { name: 'Punctuation',        keys: [',','.',';',"'",'/','a','s','l','k'],   newKeys: [',','.',"'",'/'] },
];

const SEGMENTS_PER_LAP = 18;   // letters in a loop track
const KEY_LEVEL_COUNT  = KEY_LEVELS.length;

// Deterministic PRNG (mulberry32) so all players on a level — and ghosts — get
// the identical track layout.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Build the loop track for a key level: a shuffled sequence weighted toward the
// newly-introduced keys so practice concentrates on them.
function trackForLevel(levelNum) {
  const lvl = KEY_LEVELS[levelNum - 1];
  if (!lvl) return null;
  const r = rng(levelNum * 2654435761);
  const pool = [];
  for (const k of lvl.keys) pool.push(k);
  for (const k of lvl.newKeys) { pool.push(k); pool.push(k); }   // extra weight
  const segs = [];
  let last = null;
  for (let i = 0; i < SEGMENTS_PER_LAP; i++) {
    let c, guard = 0;
    do { c = pool[Math.floor(r() * pool.length)]; } while (c === last && ++guard < 8);
    segs.push(c); last = c;
  }
  return segs;
}

function levelInfo(levelNum) {
  const lvl = KEY_LEVELS[levelNum - 1];
  if (!lvl) return null;
  return { level: levelNum, name: lvl.name, type: 'keys', keys: lvl.keys, newKeys: lvl.newKeys, segments: SEGMENTS_PER_LAP };
}

module.exports = {
  FINGER, KEY_LEVELS, KEY_LEVEL_COUNT, SEGMENTS_PER_LAP,
  trackForLevel, levelInfo,
  // Level numbers 1..KEY_LEVEL_COUNT are key drills; KEY_LEVEL_COUNT+1 is story mode.
  STORY_LEVEL: KEY_LEVEL_COUNT + 1,
};
