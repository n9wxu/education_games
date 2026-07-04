'use strict';
// ── Spelling Sniper — client game engine ────────────────────────────────────
// Shoot MISSPELLED words. When you hit one, type the correct spelling to score.

const socket = io({ path: '/sniper/socket.io' });
let token      = localStorage.getItem('sniper_token') || null;
let myId       = null;
let mySeat     = null;
let myUsername = '';
let myColor    = '#ff6644';
let gamePhase  = 'auth';
let lastState  = null;
let stateTimestamp = 0;

const PALETTE = [
  '#44aaff','#ff4455','#44dd88','#ffaa00','#cc44ff','#00ccff','#ff6644','#ffdd33',
  '#ff77cc','#00ffaa','#7744ff','#ff3300','#55ffff','#aaff00','#ff8800','#ee44aa',
];
let selectedColor = localStorage.getItem('sniper_color') || PALETTE[6]; // default orange-red
let selectedShip  = parseInt(localStorage.getItem('sniper_ship') || '0', 10);

// ── Physics constants ──────────────────────────────────────────────────────────
const SERVER_TICK_MS   = 50;
const SHIP_SPEED       = 10;
const BULLET_SPEED_PX  = 9;
const FIRE_COOLDOWN_MS = 120;
const MAX_BULLETS      = 4;

let localShipX  = 450;
let prevWordMap  = new Map();
let prevShipMap  = new Map();

let clientBullets = [];
let remoteBullets = [];
let lastFireTime  = 0;

// ── Game freeze / pause state ──────────────────────────────────────────────────
let gameFrozen        = false;
let gameManuallyPaused = false;
let frozenWordId      = null;   // wordId being answered
let spellCheckActive  = false;  // this client is the one typing

// ── Particles / flashes ────────────────────────────────────────────────────────
const particles = [];
const flashes   = [];
const shakes    = [];

// ── Audio ──────────────────────────────────────────────────────────────────────
let audioCtx     = null;
let sfxVol       = parseFloat(localStorage.getItem('sniper_sfx_vol') ?? '0.7');
let musicVol     = parseFloat(localStorage.getItem('sniper_music_vol') ?? '0.4');
let musicGain    = null;
let sfxGain      = null;
let chipPlayer   = null;
let currentTrack = -1;
let analyserL = null, analyserR = null;
const VU_BUFL = new Uint8Array(1024);
const VU_BUFR = new Uint8Array(1024);

function getACtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = audioCtx.createGain(); musicGain.gain.value = musicVol; musicGain.connect(audioCtx.destination);
    sfxGain   = audioCtx.createGain(); sfxGain.gain.value = sfxVol;   sfxGain.connect(audioCtx.destination);
    const unlockBuf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const unlockSrc = audioCtx.createBufferSource();
    unlockSrc.buffer = unlockBuf; unlockSrc.connect(audioCtx.destination); unlockSrc.start(0);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
['click','keydown','touchstart'].forEach(evt =>
  document.addEventListener(evt, () => { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); },
    { capture: true, passive: true })
);

function setSfxVol(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  localStorage.setItem('sniper_sfx_vol', sfxVol);
  if (sfxGain) sfxGain.gain.value = sfxVol;
  document.querySelectorAll('#sfx-vol,#lob-sfx-vol').forEach(el => { el.value = Math.round(sfxVol * 100); });
}
function setMusicVol(v) {
  musicVol = Math.max(0, Math.min(1, v));
  localStorage.setItem('sniper_music_vol', musicVol);
  if (musicGain) musicGain.gain.value = musicVol;
  document.querySelectorAll('#music-vol,#lob-music-vol').forEach(el => { el.value = Math.round(musicVol * 100); });
}

// ── SFX ───────────────────────────────────────────────────────────────────────
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

function playHitMisspelling() {
  // triumphant "got it!" sound
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  [330, 440, 550, 660].forEach((f, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square'; osc.connect(g); g.connect(sfxGain);
    const t = t0 + i * 0.055;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t); osc.stop(t + 0.13);
  });
}

function playCorrectSpelling() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  [440, 660, 880, 1100].forEach((f, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.connect(g); g.connect(sfxGain);
    const t = t0 + i * 0.07;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.start(t); osc.stop(t + 0.19);
  });
}

function playWrongSpelling() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'sawtooth'; osc.connect(g); g.connect(sfxGain);
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.35);
  g.gain.setValueAtTime(0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
  osc.start(t0); osc.stop(t0 + 0.36);
}

function playBadShot() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'triangle'; osc.connect(g); g.connect(sfxGain);
  osc.frequency.setValueAtTime(300, t0);
  osc.frequency.exponentialRampToValueAtTime(100, t0 + 0.25);
  g.gain.setValueAtTime(0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  osc.start(t0); osc.stop(t0 + 0.26);
}

function playLifeLost() {
  const ctx = getACtx(); if (!sfxGain) return;
  const t0 = ctx.currentTime + 0.05;
  [440, 330, 220].forEach((f, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth'; osc.connect(g); g.connect(sfxGain);
    const t = t0 + i * 0.12;
    osc.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t); osc.stop(t + 0.11);
  });
}

// ── Music ─────────────────────────────────────────────────────────────────────
const MOD_TRACKS = [
  '/sniper/2nd_pm.s3m', '/sniper/aryx.s3m', '/sniper/deadlock.xm', '/sniper/external.xm',
  '/sniper/hymn_to_aurora.mod', '/sniper/pod.s3m', '/sniper/space_debris.mod', '/sniper/radix_-_yuki_satellites',
];

function isLibOpenmptReady() {
  const m = window.libopenmpt || window.Module;
  if (!m) return false;
  return m.calledRun === true || typeof m._malloc === 'function';
}

function initChipPlayer() {
  if (chipPlayer) return true;
  if (!window.ChiptuneJsPlayer || !isLibOpenmptReady()) return false;
  const ctx = getACtx();
  const cfg = new ChiptuneJsConfig(0, 70, 4, ctx);
  chipPlayer = new ChiptuneJsPlayer(cfg);
  chipPlayer.touchLocked = false;
  chipPlayer.onEnded(() => setTimeout(playNextTrack, 400));
  chipPlayer.onError(() => setTimeout(playNextTrack, 400));
  return true;
}

function playNextTrack() {
  if (!chipPlayer || !musicGain) return;
  let next;
  do { next = Math.floor(Math.random() * MOD_TRACKS.length); }
  while (MOD_TRACKS.length > 1 && next === currentTrack);
  currentTrack = next;
  chipPlayer.load(MOD_TRACKS[currentTrack], buf => {
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
      splitter.connect(analyserL, 0); splitter.connect(analyserR, 1);
      analyserL.connect(merger, 0, 0); analyserR.connect(merger, 0, 1);
      merger.connect(musicGain);
    }
  });
}

function startMusic() {
  if (!initChipPlayer()) { setTimeout(startMusic, 300); return; }
  if (!chipPlayer.currentPlayingNode) playNextTrack();
}

function stopMusic() {
  if (chipPlayer) { chipPlayer.stop(); currentTrack = -1; }
  analyserL = analyserR = null;
}

// ── VU meters ─────────────────────────────────────────────────────────────────
function drawVuMeters() {
  if (!analyserL || !analyserR) return;
  analyserL.getByteTimeDomainData(VU_BUFL);
  analyserR.getByteTimeDomainData(VU_BUFR);
  const blen = VU_BUFL.length;
  const CX = 40, RX = LOGICAL_W - 40, SCALE = 40;
  ctx.fillStyle = 'rgba(3,5,18,0.88)';
  ctx.fillRect(0, 0, CX + SCALE + 1, LOGICAL_H);
  ctx.fillRect(RX - SCALE - 1, 0, SCALE + 41, LOGICAL_H);
  ctx.fillStyle = 'rgba(80,30,10,0.4)';
  ctx.fillRect(CX, 0, 1, LOGICAL_H);
  ctx.fillRect(RX, 0, 1, LOGICAL_H);
  ctx.fillStyle = 'rgba(255,140,80,0.85)';
  for (let y = 0; y < LOGICAL_H; y++) {
    const idx = Math.round((LOGICAL_H - 1 - y) * (blen - 1) / (LOGICAL_H - 1));
    const aL  = Math.round((VU_BUFL[idx] - 128) / 128 * SCALE);
    const aR  = Math.round((VU_BUFR[idx] - 128) / 128 * SCALE);
    ctx.fillRect(CX + Math.min(0, aL), y, Math.max(1, Math.abs(aL)), 1);
    ctx.fillRect(RX + Math.min(0, aR), y, Math.max(1, Math.abs(aR)), 1);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function initVolumeUI() {
  document.querySelectorAll('#sfx-vol,#lob-sfx-vol').forEach(el => { el.value = Math.round(sfxVol * 100); });
  document.querySelectorAll('#music-vol,#lob-music-vol').forEach(el => { el.value = Math.round(musicVol * 100); });
}
initVolumeUI();

// ── Interpolation ─────────────────────────────────────────────────────────────
function interpolated() {
  if (!lastState) return null;
  const t = Math.min(1, (performance.now() - stateTimestamp) / SERVER_TICK_MS);
  return {
    ...lastState,
    words: lastState.words.map(w => {
      if (w.frozen) return w; // frozen words don't interpolate
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

// ── Bullet firing ─────────────────────────────────────────────────────────────
function fireBullet() {
  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return;
  if (gameFrozen) return;
  if (spellCheckActive) return;
  if (clientBullets.length >= MAX_BULLETS) return;
  lastFireTime = now;
  clientBullets.push({ x: localShipX, y: 525, prevY: 525, color: myColor });
  socket.emit('bulletFired', { x: Math.round(localShipX) });
  playShoot();
}

function bulletHitsWord(b, w) {
  const halfW = (w.text.length * 11 + 28) / 2;
  const halfH = 17;
  if (Math.abs(b.x - w.x) > halfW) return false;
  const wordTop = w.y - halfH, wordBot = w.y + halfH;
  return b.prevY >= wordTop && b.y <= wordBot;
}

// ── Canvas / sizing ───────────────────────────────────────────────────────────
const LOGICAL_W = 900, LOGICAL_H = 600;
const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
const wrap   = document.getElementById('game-wrap');

function resize() {
  const scale = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
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

// ── Starfield ──────────────────────────────────────────────────────────────────
const STARS = Array.from({length: 120}, () => ({
  x: Math.random() * LOGICAL_W,
  y: Math.random() * LOGICAL_H,
  r: Math.random() * 1.5 + 0.3,
  a: Math.random() * 0.7 + 0.3,
}));

function addFlash(x, y, text, color) {
  flashes.push({ x, y, text, color, ttl: 60, maxTtl: 60 });
}
function addShake(frames) { shakes.push({ ttl: frames }); }

function spawnParticles(x, y, color) {
  const cols = [color, '#ffaa00', '#ff6644', '#fff', '#ffdd33'];
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      color: cols[i % cols.length],
      ttl: 50 + Math.random() * 25 | 0,
      maxTtl: 75,
      r: Math.random() * 3 + 1,
    });
  }
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawStars() {
  for (const s of STARS) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.fill();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function drawWord(w) {
  const text = w.text;
  ctx.font = 'bold 18px monospace';
  const tw   = ctx.measureText(text).width;
  const pad  = 14;
  const bw   = tw + pad * 2;
  const bh   = 34;
  const x    = w.x - bw / 2;
  const y    = w.y - bh / 2;

  ctx.save();

  // Background
  ctx.beginPath();
  roundRect(ctx, x, y, bw, bh, 7);
  ctx.fillStyle = w.frozen ? 'rgba(10,18,40,0.95)' : '#0d0f24';
  ctx.fill();

  // Border — frozen words glow brightly
  if (w.frozen) {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
    ctx.strokeStyle = `rgba(255,200,80,${0.7 + pulse * 0.3})`;
    ctx.lineWidth   = 3;
    ctx.shadowColor = '#ffcc44';
    ctx.shadowBlur  = 12 + pulse * 8;
  } else {
    ctx.strokeStyle = w.color;
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 0;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle    = w.frozen ? '#ffcc44' : '#fff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w.x, w.y);
  ctx.restore();
}

// ── Ship shapes ───────────────────────────────────────────────────────────────
const SHIP_SHAPES = [
  c => { c.moveTo(0,-22);c.lineTo(14,10);c.lineTo(6,6);c.lineTo(0,14);c.lineTo(-6,6);c.lineTo(-14,10); },
  c => { c.moveTo(0,-20);c.lineTo(22,12);c.lineTo(10,8);c.lineTo(0,14);c.lineTo(-10,8);c.lineTo(-22,12); },
  c => { c.moveTo(0,-26);c.lineTo(6,14);c.lineTo(0,10);c.lineTo(-6,14); },
  c => { c.moveTo(0,-18);c.lineTo(6,-6);c.lineTo(20,14);c.lineTo(10,8);c.lineTo(0,12);c.lineTo(-10,8);c.lineTo(-20,14);c.lineTo(-6,-6); },
  c => { c.moveTo(-9,-18);c.lineTo(9,-18);c.lineTo(13,10);c.lineTo(9,14);c.lineTo(-9,14);c.lineTo(-13,10); },
  c => { c.arc(0,-4,18,Math.PI*1.15,Math.PI*1.85,false);c.lineTo(0,-22);c.arc(0,-4,10,Math.PI*1.85,Math.PI*1.15,true); },
  c => { c.moveTo(0,-22);c.lineTo(18,0);c.lineTo(8,14);c.lineTo(-8,14);c.lineTo(-18,0); },
  c => { c.ellipse(0,4,18,8,0,0,Math.PI*2);c.moveTo(-8,-4);c.ellipse(0,-4,8,8,0,0,Math.PI*2); },
  c => { c.moveTo(0,-14);c.lineTo(6,-4);c.lineTo(26,6);c.lineTo(18,14);c.lineTo(8,8);c.lineTo(0,12);c.lineTo(-8,8);c.lineTo(-18,14);c.lineTo(-26,6);c.lineTo(-6,-4); },
  c => { c.moveTo(0,-20);c.lineTo(4,-4);c.lineTo(14,-2);c.lineTo(16,14);c.lineTo(10,10);c.lineTo(4,12);c.lineTo(-4,12);c.lineTo(-10,10);c.lineTo(-16,14);c.lineTo(-14,-2);c.lineTo(-4,-4); },
  c => { c.moveTo(0,-24);c.lineTo(12,6);c.lineTo(6,2);c.lineTo(6,14);c.lineTo(-6,14);c.lineTo(-6,2);c.lineTo(-12,6); },
  c => { c.moveTo(0,-26);c.lineTo(8,4);c.lineTo(14,14);c.lineTo(6,10);c.lineTo(0,14);c.lineTo(-6,10);c.lineTo(-14,14);c.lineTo(-8,4); },
  c => { c.moveTo(-24,14);c.lineTo(-10,-4);c.lineTo(0,-20);c.lineTo(10,-4);c.lineTo(24,14);c.lineTo(14,10);c.lineTo(0,-8);c.lineTo(-14,10); },
  c => { c.moveTo(0,-22);c.lineTo(4,-8);c.lineTo(20,-12);c.lineTo(8,2);c.lineTo(14,14);c.lineTo(0,6);c.lineTo(-14,14);c.lineTo(-8,2);c.lineTo(-20,-12);c.lineTo(-4,-8); },
  c => { c.moveTo(0,-22);c.lineTo(4,-4);c.lineTo(22,-16);c.lineTo(10,0);c.lineTo(22,16);c.lineTo(4,4);c.lineTo(0,16);c.lineTo(-4,4);c.lineTo(-22,16);c.lineTo(-10,0);c.lineTo(-22,-16);c.lineTo(-4,-4); },
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
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(0, -5 * scale, 3 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (engine) {
    ctx.beginPath();
    ctx.ellipse(0, 14, 4, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,130,60,${0.6 + Math.random() * 0.4})`;
    ctx.shadowColor = '#f84';
    ctx.shadowBlur = 12;
    ctx.fill();
  }
  ctx.restore();
}

function drawShip(x, y, color, shipType) {
  ctx.save();
  ctx.translate(x, y);
  drawShipShape(shipType, color, 1, !gameFrozen);
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

// ── Main render loop ──────────────────────────────────────────────────────────
function render() {
  requestAnimationFrame(render);
  if (gamePhase !== 'playing' && gamePhase !== 'ended') return;

  // Move ship (only when not spell-checking)
  if (gamePhase === 'playing' && !spellCheckActive) {
    const left  = keys.ArrowLeft || keys.a || ctrlState.left;
    const right = keys.ArrowRight || keys.d || ctrlState.right;
    const spd   = SHIP_SPEED * (16.67 / SERVER_TICK_MS);
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
  ctx.strokeStyle = 'rgba(200,80,40,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const state = interpolated();
  if (!state) { ctx.restore(); return; }

  // Advance bullets (skip if spell-check overlay is active for this player)
  if (!spellCheckActive && !gameFrozen) {
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
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
      remoteBullets[i].y -= BULLET_SPEED_PX;
      if (remoteBullets[i].y < -20) remoteBullets.splice(i, 1);
    }
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.ttl--;
    if (p.ttl <= 0) { particles.splice(i, 1); continue; }
    const alpha = p.ttl / p.maxTtl;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fillStyle = p.color + Math.floor(alpha * 255).toString(16).padStart(2,'0');
    ctx.fill();
  }

  // Words
  for (const w of state.words) drawWord(w);

  // Remote bullets
  for (const b of remoteBullets) drawBullet(b, true);

  // Local bullets (hidden during spell input to reduce distraction)
  if (!spellCheckActive) {
    for (const b of clientBullets) drawBullet(b, false);
  }

  // Ships
  for (const s of state.ships) {
    if (!s.active) continue;
    if (s.id === myId) {
      drawShip(s.x, 545, s.color, s.shipType);
    } else {
      drawGhostShip(s.x, 545, s.color, s.shipType);
    }
    ctx.font = s.id === myId ? '11px system-ui' : '9px system-ui';
    ctx.fillStyle = s.color;
    ctx.textAlign = 'center';
    ctx.fillText(s.username, s.x, 570);
  }

  // Flashes
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

  ctx.restore();
  updateHUD(state);
}
requestAnimationFrame(render);

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD(state) {
  document.getElementById('team-score').textContent = `SCORE ${state.teamScore}`;
  const myShip = state.ships.find(s => s.id === myId);
  if (myShip) {
    document.getElementById('player-level').textContent = `LV ${myShip.level || 1}`;
  }
  const badgeEl = document.getElementById('player-badges');
  badgeEl.innerHTML = '';
  for (const s of state.ships) {
    const d = document.createElement('div');
    d.className = 'badge';
    d.style.borderColor = s.color;
    d.style.color = s.color;
    d.style.opacity = s.active ? '1' : '0.35';
    d.innerHTML = `${s.username} <span class="hearts">${'♥'.repeat(Math.max(0, s.lives))}</span>`;
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

// ── Spell-check overlay ────────────────────────────────────────────────────────
function showSpellOverlay(wordId, displayAs) {
  spellCheckActive = true;
  frozenWordId     = wordId;
  document.getElementById('spell-display-word').textContent = displayAs;
  const inp = document.getElementById('spell-input');
  inp.value = '';
  inp.className = '';
  document.getElementById('spell-err').textContent = '';
  document.getElementById('spell-overlay').classList.add('active');
  setTimeout(() => inp.focus(), 50);
  playHitMisspelling();
}

function hideSpellOverlay() {
  spellCheckActive = false;
  frozenWordId     = null;
  document.getElementById('spell-overlay').classList.remove('active');
  document.getElementById('spell-input').blur();
}

function clearSpellErr() {
  document.getElementById('spell-input').className = '';
  document.getElementById('spell-err').textContent = '';
}

function submitSpelling() {
  if (!spellCheckActive) return;
  const answer = document.getElementById('spell-input').value.trim();
  if (!answer) return;
  socket.emit('spellAnswer', { wordId: frozenWordId, answer });
  // Disable input while waiting for server response
  document.getElementById('spell-input').disabled = true;
  document.getElementById('spell-submit').disabled = true;
}

function showFreezeOverlay(by) {
  if (spellCheckActive) return; // shooter sees spell overlay instead
  document.getElementById('freeze-msg-sub').textContent =
    by ? `${by} is spelling a word…` : 'Someone is spelling a word…';
  document.getElementById('freeze-overlay').classList.add('active');
}

function hideFreezeOverlay() {
  document.getElementById('freeze-overlay').classList.remove('active');
}

function showPauseOverlay() {
  const el = document.getElementById('pause-overlay');
  if (el) { el.style.display = 'flex'; el.style.pointerEvents = 'none'; }
}
function hidePauseOverlay() {
  const el = document.getElementById('pause-overlay');
  if (el) el.style.display = 'none';
}

// ── Lobby helpers ─────────────────────────────────────────────────────────────
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
  localStorage.setItem('sniper_color', c);
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
  localStorage.setItem('sniper_ship', i);
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
    const mastery = await fetch('/sniper/api/my-mastery', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json());
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

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLogin()    { document.getElementById('login-form').style.display=''; document.getElementById('register-form').style.display='none'; }
function showRegister() { document.getElementById('login-form').style.display='none'; document.getElementById('register-form').style.display=''; }

// ── Auth ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  getACtx();
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value;
  document.getElementById('l-err').textContent = '';
  try {
    const r = await fetch('/sniper/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { document.getElementById('l-err').textContent = d.error; return; }
    token = d.token; myUsername = d.username;
    localStorage.setItem('sniper_token', token);
    joinGame();
  } catch(e) { document.getElementById('l-err').textContent = 'Connection error'; }
}

async function doRegister() {
  getACtx();
  const user = document.getElementById('r-user').value.trim();
  const pass = document.getElementById('r-pass').value;
  document.getElementById('r-err').textContent = '';
  try {
    const r = await fetch('/sniper/api/register', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user, password: pass }) });
    const d = await r.json();
    if (!r.ok) { document.getElementById('r-err').textContent = d.error; return; }
    token = d.token; myUsername = d.username;
    localStorage.setItem('sniper_token', token);
    joinGame();
  } catch(e) { document.getElementById('r-err').textContent = 'Connection error'; }
}

function joinGame() {
  getACtx();
  const btn = document.getElementById('join-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
  socket.emit('join', { token, color: selectedColor, shipType: selectedShip });
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
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

function addMasteredTag(word, grade) {
  const panel = document.getElementById('mastered-panel');
  const title = document.getElementById('mastered-panel-title');
  if (!panel) return;
  if (title) title.style.display = '';
  const tag = document.createElement('div');
  tag.className = 'mastered-tag';
  tag.textContent = word;
  tag.title = `Grade ${grade}`;
  const first = panel.children[1];
  if (first) panel.insertBefore(tag, first); else panel.appendChild(tag);
  while (panel.children.length > 13) panel.removeChild(panel.lastChild);
}

// ── Input: keyboard ───────────────────────────────────────────────────────────
const keys = { ArrowLeft:false, ArrowRight:false, a:false, d:false, ' ':false, ArrowUp:false };
const ctrlState = { left: false, right: false, fire: false };
const FIRE_KEYS = new Set([' ', 'ArrowUp']);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && gamePhase === 'playing' && !e.repeat) {
    if (gameManuallyPaused) socket.emit('resume');
    else if (!gameFrozen) socket.emit('pause');
    return;
  }
  if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
  if (gamePhase !== 'playing') return;
  if (FIRE_KEYS.has(e.key) && !e.repeat) fireBullet();
  socket.emit('input', { x: Math.round(localShipX) });
});
document.addEventListener('keyup', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key in keys) { keys[e.key] = false; }
  if (gamePhase !== 'playing') return;
  socket.emit('input', { x: Math.round(localShipX) });
});

// ── Input: touch / mobile buttons ────────────────────────────────────────────
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
  if (k !== 'fire' && gamePhase === 'playing') socket.emit('input', { x: Math.round(localShipX) });
}

document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });

function bindButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ctrlDown(key); });
  el.addEventListener('pointerup',     () => ctrlUp(key));
  el.addEventListener('pointercancel', () => ctrlUp(key));
}
bindButton('btn-left',  'left');
bindButton('btn-right', 'right');
bindButton('btn-fire',  'fire');
document.getElementById('fs-btn')?.addEventListener('click', toggleFullscreen);
document.getElementById('gear-btn')?.addEventListener('click', () => {
  document.getElementById('settings-panel')?.classList.toggle('open');
});

// ── Canvas tap / touch ────────────────────────────────────────────────────────
function handleCanvasTap(clientX, clientY) {
  if (gamePhase !== 'playing' || spellCheckActive) return;
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

let touchStartX = null;
canvas.addEventListener('touchstart', e => { e.preventDefault(); touchStartX = e.touches[0].clientX; }, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (touchStartX === null || gamePhase !== 'playing' || spellCheckActive) return;
  const dx = e.touches[0].clientX - touchStartX;
  if (dx < -10) localShipX = Math.max(30, localShipX - 4);
  if (dx > 10)  localShipX = Math.min(LOGICAL_W - 30, localShipX + 4);
  socket.emit('input', { x: Math.round(localShipX) });
}, { passive: true });
canvas.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const dx = (t && touchStartX !== null) ? Math.abs(t.clientX - touchStartX) : 999;
  touchStartX = null;
  if (gamePhase === 'playing' && !spellCheckActive) socket.emit('input', { x: Math.round(localShipX) });
  if (dx < 12 && t) { e.preventDefault(); handleCanvasTap(t.clientX, t.clientY); }
}, { passive: false });
canvas.addEventListener('click', e => handleCanvasTap(e.clientX, e.clientY));

function stopIfNoTouches(e) {
  if (e.touches.length > 0) return;
  ctrlState.left = false; ctrlState.right = false;
}
document.addEventListener('touchend',    stopIfNoTouches, { passive: true });
document.addEventListener('touchcancel', stopIfNoTouches, { passive: true });

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('joined', d => {
  mySeat     = d.seat;
  myColor    = d.color;
  selectedShip = d.shipType ?? selectedShip;
  myId       = socket.id;
  localShipX = 150 + d.seat * 200;
  clientBullets  = [];
  remoteBullets  = [];
  gameFrozen          = false;
  gameManuallyPaused  = false;
  spellCheckActive    = false;
  hideSpellOverlay();
  hideFreezeOverlay();
  hidePauseOverlay();
  const elimEl = document.getElementById('elim-section');
  if (elimEl) elimEl.style.display = 'none';
  const panel = document.getElementById('mastered-panel');
  if (panel) panel.querySelectorAll('.mastered-tag').forEach(t => t.remove());
  const title = document.getElementById('mastered-panel-title');
  if (title) title.style.display = 'none';
  gamePhase = 'playing';
  showScreen('game-screen');
  resize();
  startMusic();
});

socket.on('authError', () => {
  localStorage.removeItem('sniper_token');
  token = null;
  showScreen('auth-screen');
  gamePhase = 'auth';
});

socket.on('gameFull', () => alert('Game is full. Try again later.'));

socket.on('roster', players => {
  const el = document.getElementById('lobby-roster');
  if (!el) return;
  el.innerHTML = players.map(p =>
    `<div class="roster-pip" style="border-color:${p.color};color:${p.color}">
       <span class="dot" style="background:${p.color}"></span>${p.username}
     </div>`
  ).join('') || '<span style="color:#445;font-size:.8rem">No one in game yet</span>';
});

socket.on('bulletFired', ({ x, color }) => {
  remoteBullets.push({ x, y: 525, color });
});

// Manual pause (Escape key)
socket.on('gamePaused', ({ by }) => {
  gameManuallyPaused = true;
  showPauseOverlay();
});

socket.on('gameUnpaused', () => {
  gameManuallyPaused = false;
  hidePauseOverlay();
});

// The game is frozen because someone shot a misspelled word
socket.on('gameFrozen', ({ by }) => {
  gameFrozen = true;
  if (!spellCheckActive) {
    showFreezeOverlay(by);
  }
});

// The shooter needs to type the correct spelling
socket.on('spellCheck', ({ wordId, displayAs }) => {
  // Re-enable input in case it was disabled from a previous attempt
  const inp = document.getElementById('spell-input');
  inp.disabled = false;
  document.getElementById('spell-submit').disabled = false;
  showSpellOverlay(wordId, displayAs);
});

// Result of a spellAnswer
socket.on('spellResult', ({ correct, word, displayAs, points, shooter, guess }) => {
  if (correct) {
    playCorrectSpelling();
    spawnParticles(localShipX, 400, myColor);
    addFlash(LOGICAL_W / 2, LOGICAL_H / 2 - 60, `✓ "${word}" — +${points} pts!`, '#44dd88');
    addShake(6);
    if (shooter === myUsername) {
      // Re-enable for next time
    }
  } else {
    playWrongSpelling();
    addShake(8);
    if (shooter === myUsername) {
      // Show error in overlay before it closes
      const inp = document.getElementById('spell-input');
      inp.className = 'wrong';
      document.getElementById('spell-err').textContent =
        `"${guess}" is incorrect. The correct spelling is "${word}". Word continues falling — try again!`;
      inp.disabled = false;
      document.getElementById('spell-submit').disabled = false;
      // Clear the error state for the next shot
      setTimeout(() => {
        if (inp.className === 'wrong') inp.className = '';
      }, 1000);
    } else {
      addFlash(LOGICAL_W / 2, LOGICAL_H / 3, `${shooter}: wrong spelling of "${word}"`, '#ff9944');
    }
  }
});

// Game unfreezes (after spell answer or timeout)
socket.on('gameResumed', () => {
  gameFrozen = false;
  if (spellCheckActive) {
    hideSpellOverlay();
  }
  hideFreezeOverlay();
  clientBullets = []; // clear stale bullets
});

// Freeze timed out without answer
socket.on('freezeTimeout', () => {
  gameFrozen = false;
  hideSpellOverlay();
  hideFreezeOverlay();
  addFlash(LOGICAL_W / 2, LOGICAL_H / 2, 'Time\'s up! Word resumes.', '#ffaa00');
  clientBullets = [];
});

// Correctly-spelled word was shot — warn the player
socket.on('badShot', ({ displayAs, shooter }) => {
  playBadShot();
  addShake(4);
  if (shooter === myUsername) {
    addFlash(LOGICAL_W / 2, LOGICAL_H / 3, `"${displayAs}" is spelled correctly! Don't shoot it!`, '#ffaa00');
  } else {
    addFlash(Math.random() * 400 + 250, Math.random() * 200 + 100,
      `${shooter} shot a correct word!`, '#ffaa00');
  }
});

// Misspelled word reached the bottom without being shot
socket.on('missedMisspelling', ({ word, displayAs, ownerId }) => {
  if (ownerId === myId) {
    playLifeLost();
    addShake(10);
    addFlash(LOGICAL_W / 2, 500, `Missed "${displayAs}" — lost a life! (correct: ${word})`, '#ff4455');
  }
});

socket.on('wordMastered', ({ word, grade }) => {
  spawnParticles(localShipX, 530, myColor);
  addFlash(localShipX, 460, `✨ MASTERED: ${word}`, '#44dd88');
  addMasteredTag(word, grade);
});

socket.on('state', state => {
  if (lastState) {
    prevWordMap = new Map(lastState.words.map(w => [w.id, w]));
    prevShipMap = new Map(lastState.ships.map(s => [s.id, s]));
  }
  lastState = state;
  stateTimestamp = performance.now();

  // Keep local freeze state in sync with server
  if (!state.paused && gameFrozen) {
    // Server says not paused but we think we are — sync up
    // (this handles disconnect/reconnect cases)
    gameFrozen = false;
    hideSpellOverlay();
    hideFreezeOverlay();
  }
});

socket.on('eliminated', ({ leaderboard } = {}) => {
  gamePhase = 'ended';
  stopMusic();
  hideSpellOverlay();
  hideFreezeOverlay();
  hidePauseOverlay();
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

socket.on('sessionResults', ({ myScore, teamScore, stats, accuracy }) => {
  gamePhase = 'ended';
  stopMusic();
  hideSpellOverlay();
  hideFreezeOverlay();
  hidePauseOverlay();

  const shots = stats.correct + stats.incorrect;
  const acc   = shots > 0 ? Math.round(stats.correct / shots * 100) : 0;
  document.getElementById('stat-row').innerHTML = `
    <div class="stat-box hi"><div class="val">${myScore}</div><div class="lbl">My Score</div></div>
    <div class="stat-box"><div class="val">${acc}%</div><div class="lbl">Accuracy</div></div>
    <div class="stat-box"><div class="val">${stats.correct}</div><div class="lbl">Correct</div></div>
    <div class="stat-box"><div class="val">${stats.seen}</div><div class="lbl">Words Seen</div></div>`;

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
  if (gamePhase !== 'ended') { gamePhase = 'ended'; showLobby(); }
});

socket.on('lobbyReset', () => {
  if (gamePhase === 'playing') joinGame();
  else { const btn = document.getElementById('join-btn'); if (btn) btn.disabled = false; }
});

socket.on('connect', () => {
  if (token && gamePhase === 'playing') joinGame();
});

setInterval(() => {
  if (gamePhase === 'playing' && !spellCheckActive) {
    socket.emit('input', { x: Math.round(localShipX) });
  }
}, 50);

// ── Auto-login ────────────────────────────────────────────────────────────────
if (token) {
  fetch('/sniper/api/me', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => { myUsername = d.username; showLobby(); })
    .catch(() => { localStorage.removeItem('sniper_token'); token = null; });
}
