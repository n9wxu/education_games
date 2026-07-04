'use strict';
// ── Spelling Invaders — client game engine ──────────────────────────────────

const socket = io({ path: '/spelling/socket.io' });
let token = localStorage.getItem('spell_token') || null;
let myId   = null;   // socket.id
let mySeat = null;
const PALETTE = [
  '#44aaff','#ff4455','#44dd88','#ffaa00','#cc44ff','#00ccff','#ff6644','#ffdd33',
  '#ff77cc','#00ffaa','#7744ff','#ff3300','#55ffff','#aaff00','#ff8800','#ee44aa',
];
let selectedColor = localStorage.getItem('spell_color') || PALETTE[0];
let selectedShip  = parseInt(localStorage.getItem('spell_ship') || '0', 10);
let myColor = selectedColor;
let myUsername = '';
let lastState  = null;
let gamePhase  = 'auth';

// ── Interpolation & client physics ────────────────────────────────────────
const SERVER_TICK_MS  = 50;   // 20 Hz
const SHIP_SPEED      = 10;   // px/tick — matches server constant
const BULLET_SPEED_PX = 9;    // px/frame at ~60fps  (≈14 px/tick × 16.67/50)
const FIRE_COOLDOWN_MS = 80;   // minimum ms between shots
const MAX_BULLETS_INFLIGHT = 4;

let stateTimestamp = 0;
let prevWordMap  = new Map();
let prevShipMap  = new Map();

// Client-authoritative ship position — never overwritten from server
let localShipX  = 450;

// Client-side bullets (cosmetic + hit detection)
let clientBullets  = [];
let remoteBullets  = [];   // other players' bullets — cosmetic only
let lastFireTime   = 0;

// Mastery celebration
const masteryParticles  = [];
let   masteredThisSession = [];   // { word, grade } — only mastered words

// Pause state
let gamePaused   = false;
let pauseUntil   = 0;
let pausedBy     = '';
let myTimeouts   = 3;
let myLevel      = 1;

// Super bomb
let myBombs = 1;

// ── Audio system ────────────────────────────────────────────────────────────
let audioCtx     = null;
let sfxVol       = parseFloat(localStorage.getItem('spell_sfx_vol') ?? '0.7');
let musicVol     = parseFloat(localStorage.getItem('spell_music_vol') ?? '0.4');
let musicGain    = null;
let sfxGain      = null;
let chipPlayer   = null;
let currentTrack = -1;
let analyserL = null, analyserR = null;
const VU_BUFL = new Uint8Array(1024);    // L channel time-domain data
const VU_BUFR = new Uint8Array(1024);    // R channel time-domain data

function getACtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = audioCtx.createGain();
    musicGain.gain.value = musicVol;
    musicGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = sfxVol;
    sfxGain.connect(audioCtx.destination);
    // Safari requires playing a sound from within the gesture call stack to unlock
    const unlockBuf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const unlockSrc = audioCtx.createBufferSource();
    unlockSrc.buffer = unlockBuf;
    unlockSrc.connect(audioCtx.destination);
    unlockSrc.start(0);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Resume AudioContext on any user interaction (keeps it alive in all browsers)
['click','keydown','touchstart'].forEach(evt =>
  document.addEventListener(evt, () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }, { capture: true, passive: true })
);

function setSfxVol(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  localStorage.setItem('spell_sfx_vol', sfxVol);
  if (sfxGain) sfxGain.gain.value = sfxVol;
  document.querySelectorAll('#sfx-vol,#lob-sfx-vol').forEach(el => { el.value = Math.round(sfxVol * 100); });
}

function setMusicVol(v) {
  musicVol = Math.max(0, Math.min(1, v));
  localStorage.setItem('spell_music_vol', musicVol);
  if (musicGain) musicGain.gain.value = musicVol;
  document.querySelectorAll('#music-vol,#lob-music-vol').forEach(el => { el.value = Math.round(musicVol * 100); });
}

// ── Procedural SFX ──────────────────────────────────────────────────────────
function playShoot() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'square'; osc.connect(g); g.connect(sfxGain);
  osc.frequency.setValueAtTime(1100, t0);
  osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.07);
  g.gain.setValueAtTime(0.18, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
  osc.start(t0); osc.stop(t0 + 0.08);
}

function playRescue() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  [440, 660, 880].forEach((f, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.connect(g); g.connect(sfxGain);
    const t = t0 + i * 0.07;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.start(t); osc.stop(t + 0.15);
  });
}

function playBadWord() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'sawtooth'; osc.connect(g); g.connect(sfxGain);
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.3);
  g.gain.setValueAtTime(0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  osc.start(t0); osc.stop(t0 + 0.31);
}

function playOops() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'triangle'; osc.connect(g); g.connect(sfxGain);
  osc.frequency.setValueAtTime(400, t0);
  osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.35);
  g.gain.setValueAtTime(0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
  osc.start(t0); osc.stop(t0 + 0.36);
}

function playBombSound() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc1 = ctx.createOscillator(), g1 = ctx.createGain();
  osc1.type = 'sawtooth'; osc1.connect(g1); g1.connect(sfxGain);
  osc1.frequency.setValueAtTime(80, t0);
  osc1.frequency.exponentialRampToValueAtTime(20, t0 + 0.6);
  g1.gain.setValueAtTime(0.5, t0);
  g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
  osc1.start(t0); osc1.stop(t0 + 0.61);
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource(), g2 = ctx.createGain();
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 3000;
  src.buffer = buf; src.connect(flt); flt.connect(g2); g2.connect(sfxGain);
  g2.gain.setValueAtTime(0.6, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
  src.start(t0); src.stop(t0 + 0.16);
}

// ── MOD tracker music (chiptune2.js + libopenmpt) ──────────────────────────
const MOD_TRACKS = [
  '/spelling/2nd_pm.s3m',
  '/spelling/aryx.s3m',
  '/spelling/deadlock.xm',
  '/spelling/external.xm',
  '/spelling/hymn_to_aurora.mod',
  '/spelling/pod.s3m',
  '/spelling/space_debris.mod',
  '/spelling/radix_-_yuki_satellites',
];

function isLibOpenmptReady() {
  // window.Module is the emscripten module; window.libopenmpt is our alias
  const m = window.libopenmpt || window.Module;
  if (!m) return false;
  return m.calledRun === true || typeof m._malloc === 'function';
}

function initChipPlayer() {
  if (chipPlayer) return true;
  if (!window.ChiptuneJsPlayer || !isLibOpenmptReady()) return false;
  const ctx = getACtx();
  const cfg = new ChiptuneJsConfig(0, 70, 4, ctx); // play-once, 70% stereo, cubic
  chipPlayer = new ChiptuneJsPlayer(cfg);
  chipPlayer.touchLocked = false; // AudioContext already running
  chipPlayer.onEnded(() => setTimeout(playNextTrack, 400));
  chipPlayer.onError(e => { console.warn('[music] error on track', MOD_TRACKS[currentTrack], e); setTimeout(playNextTrack, 400); });
  return true;
}

function playNextTrack() {
  if (!chipPlayer || !musicGain) return;
  let next;
  do { next = Math.floor(Math.random() * MOD_TRACKS.length); }
  while (MOD_TRACKS.length > 1 && next === currentTrack);
  currentTrack = next;
  const trackName = MOD_TRACKS[currentTrack];
  chipPlayer.load(trackName, buf => {
    chipPlayer.play(buf);
    if (chipPlayer.currentPlayingNode) {
      const node = chipPlayer.currentPlayingNode;
      node.disconnect();
      const ac = getACtx();
      const splitter = ac.createChannelSplitter(2);
      const merger   = ac.createChannelMerger(2);
      analyserL = ac.createAnalyser(); analyserL.fftSize = 1024;
      analyserR = ac.createAnalyser(); analyserR.fftSize = 1024;
      node.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      analyserL.connect(merger, 0, 0);
      analyserR.connect(merger, 0, 1);
      merger.connect(musicGain);
    }
  });
}

function startMusic() {
  if (!initChipPlayer()) {
    // libopenmpt WASM still initialising — retry shortly
    setTimeout(startMusic, 300);
    return;
  }
  if (!chipPlayer.currentPlayingNode) playNextTrack();
}

function stopMusic() {
  if (chipPlayer) { chipPlayer.stop(); currentTrack = -1; }
  analyserL = analyserR = null;
}

// Oscillograph: entire analyser buffer mapped directly to rows, bottom=oldest, top=newest.
function drawVuMeters() {
  if (!analyserL || !analyserR) return;

  analyserL.getByteTimeDomainData(VU_BUFL);
  analyserR.getByteTimeDomainData(VU_BUFR);

  const blen  = VU_BUFL.length;   // 1024
  const CX    = 40;                // center of left strip
  const RX    = LOGICAL_W - 40;   // center of right strip
  const SCALE = 40;                // ±40px max deflection

  // Strip backgrounds
  ctx.fillStyle = 'rgba(3,5,18,0.88)';
  ctx.fillRect(0,        0, CX + SCALE + 1, LOGICAL_H);
  ctx.fillRect(RX - SCALE - 1, 0, SCALE + 41, LOGICAL_H);

  // Center reference lines
  ctx.fillStyle = 'rgba(50,70,160,0.4)';
  ctx.fillRect(CX, 0, 1, LOGICAL_H);
  ctx.fillRect(RX, 0, 1, LOGICAL_H);

  // Waveform — single bright colour, buffer[0] at bottom, buffer[N-1] at top
  ctx.fillStyle = 'rgba(120,225,255,0.92)';
  for (let y = 0; y < LOGICAL_H; y++) {
    const idx = Math.round((LOGICAL_H - 1 - y) * (blen - 1) / (LOGICAL_H - 1));
    const aL  = Math.round((VU_BUFL[idx] - 128) / 128 * SCALE);
    const aR  = Math.round((VU_BUFR[idx] - 128) / 128 * SCALE);
    ctx.fillRect(CX + Math.min(0, aL), y, Math.max(1, Math.abs(aL)), 1);
    ctx.fillRect(RX + Math.min(0, aR), y, Math.max(1, Math.abs(aR)), 1);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function useBomb() {
  if (gamePhase !== 'playing' || gamePaused || myBombs <= 0) return;
  socket.emit('bomb');
  playBombSound();
}

function initVolumeUI() {
  document.querySelectorAll('#sfx-vol,#lob-sfx-vol').forEach(el => { el.value = Math.round(sfxVol * 100); });
  document.querySelectorAll('#music-vol,#lob-music-vol').forEach(el => { el.value = Math.round(musicVol * 100); });
}
initVolumeUI();

function interpolated() {
  if (!lastState) return null;
  const t = Math.min(1, (performance.now() - stateTimestamp) / SERVER_TICK_MS);
  return {
    ...lastState,
    words: lastState.words.map(w => {
      const p = prevWordMap.get(w.id);
      return p ? { ...w, x: lerp(p.x, w.x, t), y: lerp(p.y, w.y, t) } : w;
    }),
    ships: lastState.ships.map(s => {
      if (s.id === myId) return { ...s, x: localShipX };
      const p = prevShipMap.get(s.id);
      return p ? { ...s, x: lerp(p.x, s.x, t) } : s;
    }),
  };
}

function fireBullet() {
  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return;
  if (gamePaused) return;
  if (clientBullets.length >= MAX_BULLETS_INFLIGHT) return;
  lastFireTime = now;
  clientBullets.push({ x: localShipX, y: 525, prevY: 525, color: myColor });
  socket.emit('bulletFired', { x: Math.round(localShipX) });
  playShoot();
}

function spawnBombParticles(positions, color) {
  const cols = [color, '#ffaa00', '#ff6644', '#fff', '#ffdd33'];
  for (const pos of positions) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 3;
      masteryParticles.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        color: cols[i % cols.length],
        ttl: 45 + Math.random() * 25 | 0, maxTtl: 70,
        r: Math.random() * 4 + 2,
      });
    }
  }
}

function bulletHitsWord(b, w) {
  const halfW = (w.text.length * 11 + 28) / 2;
  const halfH = 17;
  if (Math.abs(b.x - w.x) > halfW) return false;
  const wordTop = w.y - halfH, wordBot = w.y + halfH;
  return b.prevY >= wordTop && b.y <= wordBot;
}

// ── Canvas / sizing ────────────────────────────────────────────────────────
const LOGICAL_W = 900, LOGICAL_H = 600;
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const wrap   = document.getElementById('game-wrap');

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / LOGICAL_W, vh / LOGICAL_H);
  const pw = Math.floor(LOGICAL_W * scale), ph = Math.floor(LOGICAL_H * scale);
  wrap.style.width  = pw + 'px';
  wrap.style.height = ph + 'px';
  canvas.width  = LOGICAL_W;
  canvas.height = LOGICAL_H;
  canvas.style.width  = pw + 'px';
  canvas.style.height = ph + 'px';
}
window.addEventListener('resize', resize);
resize();

// ── Stars (static starfield) ───────────────────────────────────────────────
const STARS = Array.from({length: 120}, () => ({
  x: Math.random() * LOGICAL_W,
  y: Math.random() * LOGICAL_H,
  r: Math.random() * 1.5 + 0.3,
  a: Math.random() * 0.7 + 0.3,
}));

// ── Hit flash queue ────────────────────────────────────────────────────────
const flashes = [];   // {x,y,text,color,ttl,maxTtl}
const shakes  = [];   // {ttl}

function addFlash(x, y, text, color) {
  flashes.push({ x, y, text, color, ttl: 60, maxTtl: 60 });
}
function addShake(frames) { shakes.push({ ttl: frames }); }

// ── Draw helpers ───────────────────────────────────────────────────────────
function drawStars() {
  for (const s of STARS) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  }
}

// ── Ship shape library (16 designs) ────────────────────────────────────────
// Each fn draws a ship centered at 0,0. scale=1 for player, 0.55 for ghost.
const SHIP_SHAPES = [
  // 0: Classic rocket
  c => { c.moveTo(0,-22);c.lineTo(14,10);c.lineTo(6,6);c.lineTo(0,14);c.lineTo(-6,6);c.lineTo(-14,10); },
  // 1: Wide delta wing
  c => { c.moveTo(0,-20);c.lineTo(22,12);c.lineTo(10,8);c.lineTo(0,14);c.lineTo(-10,8);c.lineTo(-22,12); },
  // 2: Dart/needle
  c => { c.moveTo(0,-26);c.lineTo(6,14);c.lineTo(0,10);c.lineTo(-6,14); },
  // 3: Hawk (swept wings)
  c => { c.moveTo(0,-18);c.lineTo(6,-6);c.lineTo(20,14);c.lineTo(10,8);c.lineTo(0,12);c.lineTo(-10,8);c.lineTo(-20,14);c.lineTo(-6,-6); },
  // 4: Shuttle (boxy)
  c => { c.moveTo(-9,-18);c.lineTo(9,-18);c.lineTo(13,10);c.lineTo(9,14);c.lineTo(-9,14);c.lineTo(-13,10); },
  // 5: Crescent (arc body)
  c => { c.arc(0,-4,18,Math.PI*1.15,Math.PI*1.85,false);c.lineTo(0,-22);c.arc(0,-4,10,Math.PI*1.85,Math.PI*1.15,true); },
  // 6: Stealth diamond
  c => { c.moveTo(0,-22);c.lineTo(18,0);c.lineTo(8,14);c.lineTo(-8,14);c.lineTo(-18,0); },
  // 7: Saucer
  c => { c.ellipse(0,4,18,8,0,0,Math.PI*2);c.moveTo(-8,-4);c.ellipse(0,-4,8,8,0,0,Math.PI*2); },
  // 8: Bat wing
  c => { c.moveTo(0,-14);c.lineTo(6,-4);c.lineTo(26,6);c.lineTo(18,14);c.lineTo(8,8);c.lineTo(0,12);c.lineTo(-8,8);c.lineTo(-18,14);c.lineTo(-26,6);c.lineTo(-6,-4); },
  // 9: Twin engine
  c => { c.moveTo(0,-20);c.lineTo(4,-4);c.lineTo(14,-2);c.lineTo(16,14);c.lineTo(10,10);c.lineTo(4,12);c.lineTo(-4,12);c.lineTo(-10,10);c.lineTo(-16,14);c.lineTo(-14,-2);c.lineTo(-4,-4); },
  // 10: Arrowhead
  c => { c.moveTo(0,-24);c.lineTo(12,6);c.lineTo(6,2);c.lineTo(6,14);c.lineTo(-6,14);c.lineTo(-6,2);c.lineTo(-12,6); },
  // 11: Dagger
  c => { c.moveTo(0,-26);c.lineTo(8,4);c.lineTo(14,14);c.lineTo(6,10);c.lineTo(0,14);c.lineTo(-6,10);c.lineTo(-14,14);c.lineTo(-8,4); },
  // 12: Boomerang V
  c => { c.moveTo(-24,14);c.lineTo(-10,-4);c.lineTo(0,-20);c.lineTo(10,-4);c.lineTo(24,14);c.lineTo(14,10);c.lineTo(0,-8);c.lineTo(-14,10); },
  // 13: Spike fighter
  c => { c.moveTo(0,-22);c.lineTo(4,-8);c.lineTo(20,-12);c.lineTo(8,2);c.lineTo(14,14);c.lineTo(0,6);c.lineTo(-14,14);c.lineTo(-8,2);c.lineTo(-20,-12);c.lineTo(-4,-8); },
  // 14: X-wing
  c => { c.moveTo(0,-22);c.lineTo(4,-4);c.lineTo(22,-16);c.lineTo(10,0);c.lineTo(22,16);c.lineTo(4,4);c.lineTo(0,16);c.lineTo(-4,4);c.lineTo(-22,16);c.lineTo(-10,0);c.lineTo(-22,-16);c.lineTo(-4,-4); },
  // 15: Diamond fighter
  c => { c.moveTo(0,-24);c.lineTo(14,0);c.lineTo(8,8);c.lineTo(0,16);c.lineTo(-8,8);c.lineTo(-14,0); },
];

function drawShipShape(type, color, scale, engine) {
  const t = Math.max(0, Math.min(15, type || 0));
  ctx.save();
  ctx.scale(scale, scale);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10 * scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  SHIP_SHAPES[t](ctx);
  ctx.closePath();
  ctx.fill();
  // Cockpit dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(0, -5 * scale, 3 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  // Engine glow (only full ships)
  if (engine) {
    ctx.beginPath();
    ctx.ellipse(0, 14, 4, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,180,60,${0.6 + Math.random() * 0.4})`;
    ctx.shadowColor = '#fa4';
    ctx.shadowBlur = 12;
    ctx.fill();
  }
  ctx.restore();
}

function drawShip(x, y, color, alive, shipType) {
  if (!alive) return;
  ctx.save();
  ctx.translate(x, y);
  drawShipShape(shipType, color, 1, true);
  ctx.restore();
}

function drawGhostShip(x, y, color, shipType) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.55;
  drawShipShape(shipType, color, 0.55, false);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawWord(w) {
  const text     = w.text;
  ctx.font       = 'bold 18px monospace';
  const tw       = ctx.measureText(text).width;
  const pad      = 14;
  const bw       = tw + pad * 2;
  const bh       = 34;
  const x        = w.x - bw / 2;
  const y        = w.y - bh / 2;
  const claimed  = w.claimed;

  ctx.save();
  // Background
  ctx.beginPath();
  roundRect(ctx, x, y, bw, bh, 7);
  ctx.fillStyle = '#0d0f24';
  ctx.fill();

  // Border — owner color, brighter if claimed by owner
  ctx.strokeStyle = w.color;
  ctx.lineWidth   = claimed ? 3 : 2;
  if (claimed) {
    ctx.shadowColor = w.color;
    ctx.shadowBlur  = 8;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Text
  ctx.fillStyle = '#fff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w.x, w.y);
  ctx.restore();
}

function drawBullet(b, small) {
  const rx = small ? 1.5 : 3, ry = small ? 5 : 8;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = b.color;
  ctx.shadowColor = b.color;
  ctx.shadowBlur  = small ? 6 : 10;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function spawnMasteryParticles(x, y) {
  const colors = [myColor, '#44dd88', '#ffdd33', '#fff'];
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 2;
    masteryParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      color: colors[i % colors.length],
      ttl: 50 + Math.random() * 20 | 0,
      maxTtl: 70,
      r: Math.random() * 3 + 1,
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Main render loop ───────────────────────────────────────────────────────
function render() {
  requestAnimationFrame(render);
  if (gamePhase !== 'playing' && gamePhase !== 'ended') return;

  // Advance local ship every frame for instant feel
  if (gamePhase === 'playing') {
    const left  = keys.ArrowLeft || keys.a  || ctrlState.left;
    const right = keys.ArrowRight || keys.d || ctrlState.right;
    const spd = SHIP_SPEED * (16.67 / SERVER_TICK_MS);
    if (left)  localShipX = Math.max(30, localShipX - spd);
    if (right) localShipX = Math.min(LOGICAL_W - 30, localShipX + spd);
  }

  // Screen shake
  let sx = 0, sy = 0;
  for (let i = shakes.length - 1; i >= 0; i--) {
    shakes[i].ttl--;
    if (shakes[i].ttl <= 0) { shakes.splice(i, 1); continue; }
    sx += (Math.random() - 0.5) * 6;
    sy += (Math.random() - 0.5) * 6;
  }

  ctx.save();
  ctx.translate(sx, sy);

  // Background
  ctx.fillStyle = '#060817';
  ctx.fillRect(-4, -4, LOGICAL_W + 8, LOGICAL_H + 8);
  drawStars();
  drawVuMeters();

  // Ground line
  ctx.beginPath();
  ctx.moveTo(0, 560);
  ctx.lineTo(LOGICAL_W, 560);
  ctx.strokeStyle = 'rgba(100,120,200,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const state = interpolated();
  if (!state) { ctx.restore(); return; }

  if (!gamePaused) {
    // Advance client bullets and check word hits
    for (let i = clientBullets.length - 1; i >= 0; i--) {
      const b = clientBullets[i];
      b.prevY = b.y;
      b.y -= BULLET_SPEED_PX;
      if (b.y < -20) { clientBullets.splice(i, 1); continue; }
      let hit = false;
      for (const w of state.words) {
        if (bulletHitsWord(b, w)) {
          socket.emit('shootWord', { wordId: w.id });
          clientBullets.splice(i, 1);
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }
    // Advance remote bullets (cosmetic only — no hit detection)
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
      remoteBullets[i].y -= BULLET_SPEED_PX;
      if (remoteBullets[i].y < -20) remoteBullets.splice(i, 1);
    }
    // Advance mastery particles
    for (let i = masteryParticles.length - 1; i >= 0; i--) {
      const p = masteryParticles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.ttl--;
      if (p.ttl <= 0) masteryParticles.splice(i, 1);
    }
  }

  // Words
  for (const w of state.words) drawWord(w);

  // Remote bullets (other players) — draw before local so local appears on top
  for (const b of remoteBullets) drawBullet(b, true);

  // Local bullets
  for (const b of clientBullets) drawBullet(b, false);

  // Ships
  for (const s of state.ships) {
    if (!s.active) continue;
    if (s.id === myId) {
      drawShip(s.x, 545, s.color, true, s.shipType);
      ctx.font = '11px system-ui';
    } else {
      drawGhostShip(s.x, 545, s.color, s.shipType);
      ctx.font = '9px system-ui';
    }
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.fillText(s.username, s.x, 570);
  }

  // Mastery particles
  for (const p of masteryParticles) {
    const alpha = p.ttl / p.maxTtl;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2,'0');
    ctx.fill();
  }

  // Hit flashes
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.ttl--;
    if (f.ttl <= 0) { flashes.splice(i, 1); continue; }
    const alpha = f.ttl / f.maxTtl;
    const rise  = (1 - alpha) * 40;
    ctx.font = 'bold 20px system-ui';
    ctx.fillStyle = f.color + Math.floor(alpha * 255).toString(16).padStart(2,'0');
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y - rise);
  }

  // Pause overlay
  if (gamePaused) {
    ctx.fillStyle = 'rgba(0,0,10,0.55)';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px system-ui';
    ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', LOGICAL_W / 2, LOGICAL_H / 2 - 20);
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#aac';
    const secs = Math.max(0, Math.ceil((pauseUntil - Date.now()) / 1000));
    ctx.fillText(`${pausedBy} called timeout · resumes in ${secs}s`, LOGICAL_W / 2, LOGICAL_H / 2 + 16);
  }

  ctx.restore();
  updateHUD(state);
}
requestAnimationFrame(render);

// ── HUD ────────────────────────────────────────────────────────────────────
function updateHUD(state) {
  document.getElementById('team-score').textContent = `SCORE ${state.teamScore}`;
  const myShip = state.ships.find(s => s.id === myId);
  if (myShip) {
    document.getElementById('player-level').textContent = `LV ${myShip.level || myLevel}`;
    myTimeouts = myShip.timeouts ?? myTimeouts;
    if (myShip.bombs !== undefined) myBombs = myShip.bombs;
  }
  const bombEl = document.getElementById('bomb-count');
  if (bombEl) bombEl.textContent = myBombs > 0 ? '💣'.repeat(myBombs) : '';
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = gamePaused ? '▶' : '⏸';
    pauseBtn.title = gamePaused ? 'Resume' : `Pause (${myTimeouts} left)`;
    pauseBtn.disabled = !gamePaused && myTimeouts <= 0;
  }
  const badgeEl = document.getElementById('player-badges');
  badgeEl.innerHTML = '';
  for (const s of state.ships) {
    const d = document.createElement('div');
    d.className = 'badge';
    d.style.borderColor = s.color;
    d.style.color = s.color;
    d.style.opacity = s.active ? '1' : '0.35';
    const hearts = '♥'.repeat(Math.max(0, s.lives));
    const tos    = s.id === myId ? ' <span class="timeouts">' + '⏸'.repeat(Math.max(0, s.timeouts ?? 0)) + '</span>' : '';
    d.innerHTML = `${s.username} <span class="hearts">${hearts}</span>${tos}`;
    badgeEl.appendChild(d);
  }

  const lbEl = document.getElementById('live-lb');
  if (lbEl) {
    const sorted = [...state.ships].sort((a, b) =>
      (b.mastered || 0) - (a.mastered || 0) || b.score - a.score
    );
    lbEl.innerHTML = sorted.map((s, i) =>
      `<div class="lb-row${s.id === myId ? ' lb-me' : ''}">` +
      `<span class="lb-rank">${i + 1}</span>` +
      `<span class="lb-name" style="color:${s.color}">${s.username}</span>` +
      `<span class="lb-m">${s.mastered || 0}★</span>` +
      `<span class="lb-pts">${s.score}</span>` +
      (s.active ? '' : '<span class="lb-out">out</span>') +
      '</div>'
    ).join('');
  }
}

// ── Roster ─────────────────────────────────────────────────────────────────
function updateRoster(players) {
  const el = document.getElementById('lobby-roster');
  if (!el) return;
  el.innerHTML = players.map(p =>
    `<div class="roster-pip" style="border-color:${p.color};color:${p.color}">
       <span class="dot" style="background:${p.color}"></span>${p.username}
     </div>`
  ).join('') || '<span style="color:#445;font-size:.8rem">No one in game yet</span>';
}

// ── Lobby ──────────────────────────────────────────────────────────────────
function renderColorPicker() {
  const row = document.getElementById('color-row');
  if (!row) return;
  row.innerHTML = PALETTE.map(c =>
    `<div class="color-swatch${c === selectedColor ? ' selected' : ''}"
      style="background:${c}" title="${c}"
      onclick="pickColor('${c}')"></div>`
  ).join('');
}

function pickColor(c) {
  selectedColor = c;
  localStorage.setItem('spell_color', c);
  renderColorPicker();
}

function renderShipPicker() {
  const row = document.getElementById('ship-row');
  if (!row) return;
  row.innerHTML = Array.from({length: 16}, (_, i) => {
    const sel = i === selectedShip ? ' selected' : '';
    return `<canvas class="ship-swatch${sel}" id="ship-sw-${i}" width="50" height="50"
      title="Ship ${i+1}" onclick="pickShip(${i})"></canvas>`;
  }).join('');
  // Draw each mini ship
  for (let i = 0; i < 16; i++) {
    const c = document.getElementById(`ship-sw-${i}`);
    if (!c) continue;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, 50, 50);
    cx.save();
    cx.translate(25, 28);
    cx.shadowColor = selectedColor;
    cx.shadowBlur = 6;
    cx.fillStyle = i === selectedShip ? selectedColor : '#667';
    cx.beginPath();
    SHIP_SHAPES[i](cx);
    cx.closePath();
    cx.fill();
    cx.restore();
  }
}

function pickShip(i) {
  selectedShip = i;
  localStorage.setItem('spell_ship', i);
  renderShipPicker();
}

async function showLobby() {
  showScreen('lobby-screen');
  stopMusic();
  document.getElementById('lobby-username').textContent = myUsername;
  document.getElementById('join-btn').disabled = false;
  renderColorPicker();
  renderShipPicker();
  initVolumeUI();
  await loadMasteryProgress();
}

async function loadMasteryProgress() {
  if (!token) return;
  try {
    const mastery = await fetch('/spelling/api/my-mastery', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());

    // Grade progress bars
    const byGrade = {};
    for (const m of mastery) {
      if (!byGrade[m.grade_level]) byGrade[m.grade_level] = { total: 0, mastered: 0 };
      byGrade[m.grade_level].total++;
      if (m.mastered) byGrade[m.grade_level].mastered++;
    }
    const grades = Object.entries(byGrade).sort(([a],[b]) => a - b);
    const progressEl = document.getElementById('grade-progress');
    if (grades.length) {
      progressEl.innerHTML = grades.map(([lv, g]) => {
        const pct = g.total ? Math.round(g.mastered / g.total * 100) : 0;
        return `<div class="grade-row">
          <span class="grade-label">Level ${lv}</span>
          <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div>
          <span class="prog-count">${g.mastered}/${g.total}</span>
        </div>`;
      }).join('');
    } else {
      progressEl.innerHTML = '<span class="empty-msg">Play a game to start tracking progress!</span>';
    }

    // All mastered words
    const masteredAll = mastery.filter(m => m.mastered);
    const masteredSection = document.getElementById('mastered-words-section');
    if (masteredAll.length) {
      masteredSection.style.display = '';
      document.getElementById('all-mastered-chips').innerHTML = masteredAll.map(m =>
        `<div class="word-chip mastered">${m.word}<span class="grade-badge">L${m.grade_level}</span></div>`
      ).join('');
    } else {
      masteredSection.style.display = 'none';
    }
  } catch {}
}

// ── Fullscreen & pause ──────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fs-btn');
  if (btn) btn.textContent = document.fullscreenElement ? '⊠' : '⛶';
});

function requestPause() {
  if (!gamePaused) {
    socket.emit('pause');
  } else if (gamePaused) {
    socket.emit('resume');
  }
}

function addMasteredTag(word, grade) {
  masteredThisSession.unshift({ word, grade });
  const panel = document.getElementById('mastered-panel');
  const title = document.getElementById('mastered-panel-title');
  if (!panel) return;
  if (title) title.style.display = '';
  const tag = document.createElement('div');
  tag.className = 'mastered-tag';
  tag.textContent = word;
  tag.title = `Grade ${grade}`;
  // Insert after title
  const first = panel.children[1];
  if (first) panel.insertBefore(tag, first); else panel.appendChild(tag);
  // Cap at 12 tags
  while (panel.children.length > 13) panel.removeChild(panel.lastChild);
}

// ── Screen transitions ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLogin()    { document.getElementById('login-form').style.display=''; document.getElementById('register-form').style.display='none'; }
function showRegister() { document.getElementById('login-form').style.display='none'; document.getElementById('register-form').style.display=''; }

// ── Auth ────────────────────────────────────────────────────────────────────
async function doLogin() {
  getACtx(); // unlock AudioContext while still in the click gesture
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  document.getElementById('l-err').textContent = '';
  try {
    const r = await fetch('/spelling/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { document.getElementById('l-err').textContent = d.error; return; }
    token = d.token; myUsername = d.username;
    localStorage.setItem('spell_token', token);
    joinGame();
  } catch(e) { document.getElementById('l-err').textContent = 'Connection error'; }
}

async function doRegister() {
  getACtx(); // unlock AudioContext while still in the click gesture
  const user = document.getElementById('r-user').value.trim();
  const pass = document.getElementById('r-pass').value;
  document.getElementById('r-err').textContent = '';
  try {
    const r = await fetch('/spelling/api/register', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { document.getElementById('r-err').textContent = d.error; return; }
    token = d.token; myUsername = d.username;
    localStorage.setItem('spell_token', token);
    joinGame();
  } catch(e) { document.getElementById('r-err').textContent = 'Connection error'; }
}

// ── Game flow ───────────────────────────────────────────────────────────────
function joinGame() {
  getACtx(); // create + unlock AudioContext during user gesture
  const btn = document.getElementById('join-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
  socket.emit('join', { token, color: selectedColor, shipType: selectedShip });
}

function startGame() {
  socket.emit('startGame', { token });
}

// ── Input: keyboard ─────────────────────────────────────────────────────────
const keys = { ArrowLeft:false, ArrowRight:false, a:false, d:false, ' ':false, ArrowUp:false };
const ctrlState = { left: false, right: false, fire: false };

const FIRE_KEYS = new Set([' ', 'ArrowUp']);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
  if (gamePhase !== 'playing') return;
  if (FIRE_KEYS.has(e.key) && !e.repeat) fireBullet();
  if ((e.key === 'b' || e.key === 'B') && !e.repeat) useBomb();
  socket.emit('input', { x: Math.round(localShipX) });
});
document.addEventListener('keyup', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key in keys) { keys[e.key] = false; }
  if (gamePhase !== 'playing') return;
  socket.emit('input', { x: Math.round(localShipX) });
});

// ── Input: touch / mobile buttons ──────────────────────────────────────────
function ctrlDown(k) {
  ctrlState[k] = true;
  document.getElementById('btn-'+k)?.classList.add('pressed');
  if (gamePhase !== 'playing') return;
  if (k === 'fire') fireBullet();
  else socket.emit('input', { x: Math.round(localShipX) });
}
function ctrlUp(k) {
  ctrlState[k] = false;
  document.getElementById('btn-'+k)?.classList.remove('pressed');
  if (k !== 'fire' && gamePhase === 'playing') {
    socket.emit('input', { x: Math.round(localShipX) });
  }
}

// ── Disable pinch-to-zoom and other multi-touch gestures ──────────────────
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });

// ── Mobile button binding via Pointer Events + capture ────────────────────
// setPointerCapture guarantees pointerup/pointercancel fire on this element
// even if the finger slides off it — the most reliable approach on iOS.
function bindButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    ctrlDown(key);
  });
  el.addEventListener('pointerup',     () => ctrlUp(key));
  el.addEventListener('pointercancel', () => ctrlUp(key));
}

bindButton('btn-left',  'left');
bindButton('btn-right', 'right');
bindButton('btn-fire',  'fire');
document.getElementById('pause-btn')?.addEventListener('click', requestPause);
document.getElementById('fs-btn')?.addEventListener('click', toggleFullscreen);
document.getElementById('gear-btn')?.addEventListener('click', () => {
  document.getElementById('settings-panel')?.classList.toggle('open');
});
document.getElementById('bomb-count')?.addEventListener('click', useBomb);
document.getElementById('btn-bomb')?.addEventListener('pointerdown', e => {
  document.getElementById('btn-bomb').setPointerCapture(e.pointerId);
  useBomb();
});

// ── Tap word to aim and shoot ────────────────────────────────────────────────
function handleCanvasTap(clientX, clientY) {
  if (gamePhase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const lx = (clientX - rect.left) * (LOGICAL_W / rect.width);
  const ly = (clientY - rect.top)  * (LOGICAL_H / rect.height);
  const state = interpolated();
  if (!state) return;

  let best = null, bestDist = Infinity;
  for (const w of state.words) {
    const halfW = (w.text.length * 11 + 28) / 2 + 24;
    if (Math.abs(lx - w.x) > halfW || Math.abs(ly - w.y) > 40) continue;
    const d = Math.hypot(lx - w.x, ly - w.y);
    if (d < bestDist) { bestDist = d; best = w; }
  }

  if (best) {
    localShipX = Math.max(30, Math.min(LOGICAL_W - 30, best.x));
    socket.emit('input', { x: Math.round(localShipX) });
    fireBullet();
  } else {
    localShipX = Math.max(30, Math.min(LOGICAL_W - 30, lx));
    socket.emit('input', { x: Math.round(localShipX) });
  }
}

// ── Touch on canvas: swipe to move, tap to aim+shoot ─────────────────────────
let touchStartX = null;
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  touchStartX = e.touches[0].clientX;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (touchStartX === null || gamePhase !== 'playing') return;
  const dx = e.touches[0].clientX - touchStartX;
  if (dx < -10) localShipX = Math.max(30, localShipX - 4);
  if (dx > 10)  localShipX = Math.min(LOGICAL_W - 30, localShipX + 4);
  socket.emit('input', { x: Math.round(localShipX) });
}, { passive: true });

canvas.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const dx = (t && touchStartX !== null) ? Math.abs(t.clientX - touchStartX) : 999;
  touchStartX = null;
  socket.emit('input', { x: Math.round(localShipX) });
  if (dx < 12 && t) {
    e.preventDefault();
    handleCanvasTap(t.clientX, t.clientY);
  }
}, { passive: false });

canvas.addEventListener('click', e => handleCanvasTap(e.clientX, e.clientY));

// Safety net: if all touches leave the screen force-stop movement
function stopIfNoTouches(e) {
  if (e.touches.length > 0) return;
  ctrlState.left = false;
  ctrlState.right = false;
  if (gamePhase === 'playing') socket.emit('input', { left: false, right: false, fire: false });
}
document.addEventListener('touchend',    stopIfNoTouches, { passive: true });
document.addEventListener('touchcancel', stopIfNoTouches, { passive: true });

// ── Socket events ────────────────────────────────────────────────────────────
socket.on('joined', d => {
  mySeat        = d.seat;
  myColor       = d.color;
  selectedShip  = d.shipType ?? selectedShip;
  myId          = socket.id;
  myLevel    = d.level || 1;
  myTimeouts = d.timeouts ?? 3;
  myBombs    = d.bombs ?? 1;
  localShipX = 150 + d.seat * 200;
  clientBullets  = [];
  remoteBullets  = [];
  gamePaused     = false;
  masteredThisSession = [];
  const elimEl = document.getElementById('elim-section');
  if (elimEl) elimEl.style.display = 'none';
  const panel = document.getElementById('mastered-panel');
  if (panel) panel.querySelectorAll('.mastered-tag').forEach(t => t.remove());
  const title = document.getElementById('mastered-panel-title');
  if (title) title.style.display = 'none';
  gamePhase  = 'playing';
  showScreen('game-screen');
  resize();
  startMusic();
});

socket.on('authError', () => {
  localStorage.removeItem('spell_token');
  token = null;
  showScreen('auth-screen');
  gamePhase = 'auth';
});

socket.on('gameFull', () => {
  alert('Game is full (max 4 players). Try again later.');
});

socket.on('roster', players => {
  updateRoster(players);
});

socket.on('gameStart', () => {});

// Real-time bullet relay — create remote bullet immediately, no poll delay
socket.on('bulletFired', ({ shooterId, x, color }) => {
  remoteBullets.push({ x, y: 525, color });
});

socket.on('gamePaused', ({ by, until, timeouts }) => {
  gamePaused = true;
  pauseUntil = until;
  pausedBy   = by;
  if (by === myUsername) myTimeouts = timeouts;
  addFlash(LOGICAL_W / 2, LOGICAL_H / 2 - 60, `${by} called timeout`, '#ffaa00');
});

socket.on('gameResumed', () => {
  gamePaused = false;
  addFlash(LOGICAL_W / 2, LOGICAL_H / 2 - 60, 'Resuming!', '#44dd88');
});

socket.on('wordMastered', ({ word, grade, bombs }) => {
  spawnMasteryParticles(localShipX, 530);
  addFlash(localShipX, 460, `✨ MASTERED: ${word}`, '#44dd88');
  addMasteredTag(word, grade);
  if (bombs !== undefined) myBombs = bombs;
  const bombEl = document.getElementById('bomb-count');
  if (bombEl) bombEl.textContent = myBombs > 0 ? '💣'.repeat(myBombs) : '';
});

socket.on('bombBlast', ({ shooter, color, destroyed, bombs }) => {
  spawnBombParticles(destroyed, color);
  addFlash(LOGICAL_W / 2, LOGICAL_H / 3, `💣 ${shooter} SUPER BOMB!`, '#ffaa00');
  addShake(12);
  if (shooter === myUsername) myBombs = bombs;
  playBombSound();
});

socket.on('state', state => {
  if (lastState) {
    prevWordMap = new Map(lastState.words.map(w => [w.id, w]));
    prevShipMap = new Map(lastState.ships.map(s => [s.id, s]));
  }
  lastState = state;
  stateTimestamp = performance.now();
});

socket.on('hit', ({ word, displayAs, correct, points, shooter, stolen }) => {
  if (shooter === myUsername) {
    playRescue();
    addFlash(localShipX, 460, `Rescued! ${points > 0 ? '+' + points : ''} ✓ ${word}`, '#44ff88');
    if (stolen) addFlash(LOGICAL_W/2, 380, 'Steal! Penalty word spawned', '#ffaa00');
  } else {
    addFlash(Math.random() * 600 + 150, Math.random() * 200 + 100,
      `${shooter}: +${points} ${word}`, '#44cc88');
  }
});

socket.on('wrongShot', ({ word, displayAs, shooter }) => {
  if (shooter === myUsername) playBadWord();
  addFlash(LOGICAL_W/2, LOGICAL_H/3, `✗ "${displayAs}" is a misspelling!`, '#ff6644');
  addShake(8);
});

socket.on('missed', ({ word, displayAs, isMisspelled, ownerId }) => {
  if (!isMisspelled) {
    if (ownerId === myId) playOops();
    addFlash(LOGICAL_W/2, 500, `Missed rescue: ${word}`, '#ff9944');
  }
});

socket.on('foul', ({ by, word }) => {
  addFlash(LOGICAL_W/2, 200, `FOUL! ${by} stole a claimed word`, '#ffaa00');
  addShake(5);
});

socket.on('eliminated', ({ leaderboard } = {}) => {
  gamePhase = 'ended';
  stopMusic();
  if (leaderboard) {
    const el = document.getElementById('elim-section');
    if (el) {
      el.style.display = '';
      document.getElementById('elim-board').innerHTML = leaderboard.map((p, i) => `
        <div class="elim-row">
          <span class="elim-rank">#${i + 1}</span>
          <span class="elim-name" style="color:${p.color}">${p.username}</span>
          <span class="elim-stat">${p.mastered} mastered</span>
          <span class="elim-stat">${p.score} pts</span>
          ${p.active ? '' : '<span class="elim-out">out</span>'}
        </div>`).join('');
    }
  }
  showLobby();
});

socket.on('sessionResults', ({ myScore, teamScore, stats }) => {
  gamePhase = 'ended';
  stopMusic();

  const shots = stats.correct + stats.incorrect;
  const acc   = shots > 0 ? Math.round(stats.correct / shots * 100) : 0;
  document.getElementById('stat-row').innerHTML = `
    <div class="stat-box hi"><div class="val">${teamScore}</div><div class="lbl">Team Score</div></div>
    <div class="stat-box"><div class="val">${myScore}</div><div class="lbl">My Score</div></div>
    <div class="stat-box"><div class="val">${acc}%</div><div class="lbl">Accuracy</div></div>
    <div class="stat-box"><div class="val">${stats.seen}</div><div class="lbl">Words Seen</div></div>
    <div class="stat-box"><div class="val">${stats.correct}</div><div class="lbl">Correct</div></div>`;

  const masteredEl = document.getElementById('mastered-chips');
  masteredEl.innerHTML = stats.masteredWords.length
    ? stats.masteredWords.map(w =>
        `<div class="word-chip mastered">${w.word}<span class="grade-badge">L${w.grade_level}</span></div>`
      ).join('')
    : '<span class="empty-msg">Keep playing to master words!</span>';

  document.getElementById('session-section').style.display = '';
  showLobby();
});

socket.on('gameOver', () => {
  stopMusic();
  if (gamePhase !== 'ended') {
    gamePhase = 'ended';
    showLobby();
  }
});

socket.on('listChanged', () => {
  // Server reloaded word list — nothing to do on client
});

// Push position to server at ~20Hz so other players and claim detection stay accurate
setInterval(() => {
  if (gamePhase === 'playing') socket.emit('input', { x: Math.round(localShipX) });
}, 50);

socket.on('lobbyReset', () => {
  if (gamePhase === 'playing') {
    // Server reset while we were mid-join (joined during 'ended' window) — rejoin automatically.
    joinGame();
  } else {
    document.getElementById('join-btn').disabled = false;
  }
});

// ── Auto-login if token stored ─────────────────────────────────────────────
socket.on('connect', () => {
  // On reconnect during a game, stay in game; otherwise go to lobby
  if (token && gamePhase === 'playing') joinGame();
});

if (token) {
  fetch('/spelling/api/me', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => { myUsername = d.username; showLobby(); })
    .catch(() => { localStorage.removeItem('spell_token'); token = null; });
}

