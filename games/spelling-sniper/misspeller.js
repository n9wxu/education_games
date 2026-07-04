'use strict';

const fs = require('fs');

// ─── Dictionary ────────────────────────────────────────────────────────────────
// Load the system word list once at startup. Variants that are real English words
// are silently dropped from the pool — we must never present a correct word as a
// misspelling of a different word.
function loadDictionary() {
  const candidates = [
    '/usr/share/dict/words',
    '/usr/share/dict/american-english',
    '/usr/share/dict/british-english',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const words = fs.readFileSync(p, 'utf8').split('\n');
        const set = new Set(words.map(w => w.toLowerCase().trim()).filter(Boolean));
        console.log(`Dictionary loaded from ${p}: ${set.size} words`);
        return set;
      }
    } catch { /* try next */ }
  }
  console.warn('No system dictionary found — real-word filtering disabled');
  return new Set();
}

const DICTIONARY = loadDictionary();
function isRealWord(w) { return DICTIONARY.has(w.toLowerCase()); }

const VOWELS     = new Set('aeiou');
const CONSONANTS = new Set('bcdfghjklmnpqrstvwxyz');

// QWERTY keyboard neighbors (consonants only — vowel swaps produce too much noise)
const QWERTY = {
  b: ['v','n'],   c: ['v','d','x'], d: ['s','f'],   f: ['d','g','r'],
  g: ['f','h','t'], h: ['g','j','y'], j: ['h','k'],  k: ['j','l'],
  l: ['k'],       m: ['n'],         n: ['b','m'],   p: ['l'],
  q: ['w'],       r: ['t','f'],     s: ['a','d'],   t: ['r','y'],
  v: ['c','b'],   w: ['q','e','s'], x: ['z','c'],   y: ['t','u'],
  z: ['x','s'],
};

// Known valid 3-letter consonant clusters (don't reject these as unpronounceable)
const VALID_CLUSTERS = new Set(['str','spr','thr','shr','spl','scr','squ','nch','rth','nth']);

function pronounceable(w) {
  const m = w.match(/[bcdfghjklmnpqrstvwxyz]{3}/gi);
  if (!m) return true;
  return m.every(c => VALID_CLUSTERS.has(c.toLowerCase()));
}

function vowelCount(w) {
  return (w.match(/[aeiou]/gi) || []).length;
}

// ─── Rule application helpers ──────────────────────────────────────────────────

function replaceAt(word, idx, oldLen, replacement) {
  return word.slice(0, idx) + replacement + word.slice(idx + oldLen);
}

// Find all non-overlapping occurrences of `find` in `word`, yield each as a separate variant
function allReplacements(word, find, replacements) {
  const results = [];
  let idx = word.indexOf(find);
  while (idx !== -1) {
    for (const rep of replacements) {
      if (rep !== find) results.push(replaceAt(word, idx, find.length, rep));
    }
    idx = word.indexOf(find, idx + 1);
  }
  return results;
}

// ─── Phonetic substitutions ────────────────────────────────────────────────────
const PHONETIC_PAIRS = [
  // [find, ...replacements]
  ['tion',  'shun', 'cion', 'sion', 'tian'],
  ['sion',  'tion', 'shun'],
  ['tion',  'shun'],
  ['ph',    'f'],
  ['ck',    'k'],
  ['igh',   'i', 'ie', 'y'],
  ['ei',    'ie'],
  ['ie',    'ei'],
  ['ou',    'ow', 'oo', 'u'],
  ['ow',    'ou', 'o'],
  ['ew',    'oo', 'u'],
  ['oa',    'o', 'oe'],
  ['ea',    'ee', 'e'],
  ['ee',    'ea', 'e'],
  ['ai',    'ay', 'a', 'ae'],
  ['ay',    'ai', 'a'],
  ['oo',    'u', 'ue', 'ou'],
  ['ue',    'oo', 'u'],
  ['ible',  'able'],
  ['able',  'ible'],
  ['ence',  'ance', 'ents'],
  ['ance',  'ence', 'ants'],
  ['ary',   'ery', 'ory'],
  ['ery',   'ary', 'ory'],
  ['ory',   'ary', 'ery'],
  ['ful',   'full'],
  ['ness',  'nes'],
  ['ment',  'mant', 'ment'],
  ['ous',   'us', 'iss'],
  ['ious',  'eous', 'us'],
  ['eous',  'ious', 'us'],
  ['ture',  'cher', 'chur', 'cher'],
  ['sure',  'shure', 'sher'],
  ['age',   'ige', 'aje'],
  ['dge',   'j', 'ge'],
  // Hard-consonant sound equivalences
  ['tch',  'ch'],              // watch→wach, catch→cach
  ['qu',   'kw'],              // queen→kween, quiz→kwiz
  ['x',    'ks', 'gz'],        // fox→foks, exit→egzit
  ['c',    'k'],               // cat→kat, cup→kup (hard C = K sound)
  ['k',    'c'],               // king→cing
  ['s',    'z'],               // see→zee, was→waz
  ['z',    's'],               // zero→sero
  ['f',    'ph'],              // fun→phun (hypercorrection)
  ['gh',   'f'],               // cough→cof, enough→enuf
  ['j',    'g'],               // jump→gump (j→g confusion)
  ['g',    'j'],               // gem→jem (soft G before e/i)
];

// Word-initial silent pairs
const INITIAL_SILENT = [
  ['wh', 'w'],
  ['wr', 'r'],
  ['kn', 'n'],
  ['gn', 'n'],
  ['pn', 'n'],
];

// Single-pass: apply all phonetic rules to `word`, add results to `out`
function applyPhoneticSingle(word, out) {
  for (const [find, ...reps] of PHONETIC_PAIRS) {
    for (const v of allReplacements(word, find, reps)) {
      if (v.length >= 2) out.add(v);
    }
  }
  for (const [find, rep] of INITIAL_SILENT) {
    if (word.startsWith(find)) out.add(rep + word.slice(find.length));
  }
  // Hard C at word start before a vowel → K or Q (cat→kat, cat→qat)
  if (/^c[aeiou]/.test(word)) {
    out.add('k' + word.slice(1));
    out.add('q' + word.slice(1));
  }
  // Drop word-final silent e  (make→mak, home→hom)
  if (word.endsWith('e') && word.length > 3 && !VOWELS.has(word[word.length - 2])) {
    out.add(word.slice(0, -1));
  }
  // Add spurious silent e (sit→site, hop→hope)
  const last = word[word.length - 1];
  if (CONSONANTS.has(last) && word.length >= 3 && !word.endsWith('ed') && !word.endsWith('er')) {
    out.add(word + 'e');
  }
}

// Two-round chaining: round1 = rules on original; round2 = rules on each round1 result.
// Together they produce all 1- and 2-rule phonetic combinations without needing
// explicit cross-product logic — the identity ("no change at this position") is
// implicit because round1 variants already sit in the pool alongside round2 ones.
function applyPhonetic(word, out) {
  const round1 = new Set();
  applyPhoneticSingle(word, round1);
  for (const v of round1) out.add(v);
  for (const v of round1) applyPhoneticSingle(v, out);
}

// ─── Doubling / halving consonants ────────────────────────────────────────────
function applyDoubling(word, out) {
  // Double consonant → single
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] === word[i + 1] && CONSONANTS.has(word[i])) {
      out.add(replaceAt(word, i, 2, word[i]));
    }
  }
  // VCV pattern: single consonant between two vowels → double it
  for (let i = 1; i < word.length - 1; i++) {
    if (CONSONANTS.has(word[i]) && VOWELS.has(word[i - 1]) && VOWELS.has(word[i + 1])) {
      out.add(replaceAt(word, i, 1, word[i] + word[i]));
    }
  }
  // Single consonant before suffix-like ending → double  (run→running style errors)
  if (/[bcdfghjklmnpqrstvwxyz](ing|ed|er|est|en)$/.test(word)) {
    const m = word.match(/^(.*[aeiou])([bcdfghjklmnpqrstvwxyz])(ing|ed|er|est|en)$/);
    if (m) out.add(m[1] + m[2] + m[2] + m[3]);
  }
}

// ─── Schwa (unstressed vowel) confusion ───────────────────────────────────────
const SCHWA_SWAPS = { a: ['e','i'], e: ['a','i'], i: ['e','a'], o: ['u'], u: ['o','e'] };

function applySchwa(word, out) {
  if (vowelCount(word) < 2) return;
  let seen = 0;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (VOWELS.has(ch)) {
      seen++;
      if (seen === 1) continue; // first vowel is usually stressed — skip
      for (const rep of (SCHWA_SWAPS[ch] || [])) {
        out.add(replaceAt(word, i, 1, rep));
      }
    }
  }
}

// ─── Adjacent letter transposition ────────────────────────────────────────────
function applyTransposition(word, out) {
  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] !== word[i + 1]) {
      // Only swap where one is a vowel and one is a consonant (most realistic errors)
      const aV = VOWELS.has(word[i]), bV = VOWELS.has(word[i + 1]);
      if (aV !== bV) {
        const v = replaceAt(word, i, 2, word[i + 1] + word[i]);
        if (pronounceable(v)) out.add(v);
      }
    }
  }
}

// ─── Syllable omission ─────────────────────────────────────────────────────────
function applySyllableOmission(word, out) {
  // Find all vowel clusters
  const clusters = [];
  const re = /[aeiou]+/gi;
  let m;
  while ((m = re.exec(word)) !== null) clusters.push({ idx: m.index, len: m[0].length });
  if (clusters.length < 3) return;
  // Drop the middle cluster (most common unstressed syllable omission)
  const mid = clusters[Math.floor(clusters.length / 2)];
  const v = word.slice(0, mid.idx) + word.slice(mid.idx + mid.len);
  if (v.length >= 3 && pronounceable(v)) out.add(v);
}

// ─── QWERTY adjacency ─────────────────────────────────────────────────────────
function applyQwerty(word, out) {
  if (word.length < 5) return; // skip short words — too likely to hit real words
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const neighbors = QWERTY[ch];
    if (!neighbors) continue;
    for (const n of neighbors) {
      const v = replaceAt(word, i, 1, n);
      if (pronounceable(v)) out.add(v);
    }
  }
}

// ─── Leet speak substitutions (grade 9+) ──────────────────────────────────────
const LEET = {
  a: ['4', '@'], e: ['3'], i: ['1'], o: ['0'],
  t: ['7'],      s: ['5', '$'], b: ['8'], g: ['9'], z: ['2'],
};

function applyLeet(word, out) {
  const chars = word.split('');
  const pos = [];
  for (let i = 0; i < chars.length; i++) {
    if (LEET[chars[i]]) pos.push(i);
  }
  if (!pos.length) return;
  // Single substitutions
  for (const p of pos) {
    for (const sub of LEET[chars[p]]) {
      const v = chars.slice(); v[p] = sub; out.add(v.join(''));
    }
  }
  // Double substitutions (all pairs)
  for (let a = 0; a < pos.length - 1; a++) {
    for (let b = a + 1; b < pos.length; b++) {
      for (const sa of LEET[chars[pos[a]]]) {
        for (const sb of LEET[chars[pos[b]]]) {
          const v = chars.slice(); v[pos[a]] = sa; v[pos[b]] = sb;
          out.add(v.join(''));
        }
      }
    }
  }
}

// ─── Common error table ────────────────────────────────────────────────────────
const COMMON = {
  enough:      ['enuf','enuff','enouf','enugh'],
  cough:       ['cof','coff','kof'],
  rough:       ['ruf','ruff'],
  tough:       ['tuf','tuff'],
  laugh:       ['laf','laff'],
  friend:      ['freind','frend','freiend'],
  because:     ['becuase','becaus','becase'],
  necessary:   ['neccessary','necessery','nessecary','necesary','necessairy'],
  separate:    ['seperate','seperete','sepperate','separete'],
  receive:     ['recieve','receve','receave','recive'],
  definitely:  ['definately','definitly','defanitly','definetly'],
  beautiful:   ['beutiful','beautifull','beatiful','beautyful','beautaful'],
  february:    ['febuary','februery','feburary','febwary'],
  wednesday:   ['wensday','wendsday','wednessday','wedensday'],
  environment: ['enviroment','enviornment','enviorment','envirenment'],
  government:  ['goverment','governement','govenment','govornment'],
  library:     ['libary','liberry','librery','libery','libray'],
  surprise:    ['suprise','surprize','surpise','suprize'],
  business:    ['buisness','busness','bizness','busyness'],
  beginning:   ['begining','beggining','begginning','beginng','begening'],
  believe:     ['beleive','belive','beleave','beleve','beleeve'],
  calendar:    ['calender','calander','calandar','callandar'],
  embarrass:   ['embarass','embarras','embaress','embarras'],
  exaggerate:  ['exagerate','exaggerrate','exaggurate','exajerate'],
  grammar:     ['grammer','gramear','gramar','gramer'],
  guarantee:   ['guarentee','garantee','guarrantee','garentee'],
  height:      ['hieght','heigth','hight','heighth'],
  independent: ['independant','independint','indepenent','independend'],
  immediately: ['immediatly','immediatley','imediately','immedietly'],
  knowledge:   ['knowlege','knolege','knowlegde','nowledge'],
  maintenance: ['maintainance','maintanance','maintenence','maintenence'],
  mischievous: ['mischievious','mischevous','mischeivous','mischieveous'],
  neighbor:    ['nieghbor','nieghbour','negibor','naybor'],
  occasion:    ['ocassion','occassion','occassion','ocasion'],
  occurrence:  ['occurence','occurance','ocurrence','occurrance'],
  privilege:   ['priviledge','privelege','privlege','privelige'],
  recommend:   ['recomend','reccomend','recommand','recomend'],
  relevant:    ['relevent','relavant','relevunt','relevint'],
  restaurant:  ['resturant','restarant','restaurent','restraunt'],
  rhythm:      ['rythm','rhythem','rythym','rithym'],
  schedule:    ['shedule','schedual','scedule','scheduel'],
  successful:  ['succesful','successfull','succesfull','succesful'],
  tomorrow:    ['tommorow','tommorrow','tomoro','tomorow'],
  until:       ['untill','untl','untile','untul'],
  vacuum:      ['vaccum','vacume','vaccume','vakuum'],
  different:   ['diferent','diffrent','differant','differnt'],
  interesting: ['intresting','intersting','interresting','intresing'],
  important:   ['importent','importint','importand','importnat'],
  wonderful:   ['wonderfull','wonderfl','wunderful','wondrful'],
  comfortable: ['confortable','comftable','comforble','comfertable'],
  vegetable:   ['vegatable','vegtable','veggetable','vegetible'],
  chocolate:   ['choclate','chocolat','choculate','choclute'],
  opposite:    ['oposite','opposit','oppossite','oppisite'],
  position:    ['posision','possition','poszition','poistion'],
  possible:    ['possble','posible','possibel','possibol'],
  question:    ['queston','questoin','qustion','queshtion'],
  medicine:    ['medecine','medicin','medicene','medicane'],
  describe:    ['discribe','descibe','discrib','descrbe'],
  practice:    ['practise','practce','pracitse','practis'],
  education:   ['educaton','educashun','educaion','edukation'],
  attention:   ['atention','attenshun','atenshun','attantion'],
  direction:   ['direstion','diresction','direcion','direcshun'],
  information: ['informashun','infomation','informtion','informaton'],
};

// ─── Main export ───────────────────────────────────────────────────────────────
// gradeLevel: below 5 → phonetic only; 5+ → also apply typo rules
function buildVariantPool(word, gradeLevel = 1) {
  const w          = word.toLowerCase().trim();
  const pool       = new Set();
  const curated    = new Set();  // COMMON entries bypass dictionary filter

  applyPhonetic(w, pool);  // chained: 1- and 2-rule phonetic combinations

  if (gradeLevel >= 5) {
    applyDoubling(w, pool);
    applySchwa(w, pool);
    applyTransposition(w, pool);
    applySyllableOmission(w, pool);
    applyQwerty(w, pool);
  }

  const known = COMMON[w];

  if (known) known.forEach(v => { pool.add(v); curated.add(v); });

  // Remove the correct spelling and junk
  pool.delete(w);
  for (const v of [...pool]) {
    if (!v || v.length < 2) { pool.delete(v); continue; }
    // Drop any algorithmic variant that is itself a real English word —
    // curated COMMON entries are trusted and kept regardless.
    if (!curated.has(v) && isRealWord(v)) pool.delete(v);
  }

  // Leet speak added after filtering — digits bypass dictionary check
  if (gradeLevel >= 9) applyLeet(w, pool);

  return [...pool];
}

module.exports = { buildVariantPool, COMMON };
