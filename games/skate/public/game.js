'use strict';
/* Skate 'n' Add — client. Problems and stars are generated here, so each child's
   game is entirely their own; the server only relays other skaters' positions and
   an additive team score. Drawing is code-based (art-swappable later). */
(() => {
const $ = s => document.querySelector(s);
const API = p => '/skate/api' + p;
let token = localStorage.getItem('sk_token') || '';
let username = '', color = '#ff5aa5';
let socket = null;

const canvas = $('#c'), ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const SKATER_R = 22, STAR_R = 30;

let prob = { a: 0, b: 0, sum: 0 };
let stars = [];
let skater = { x: W / 2, y: H - 60, tx: W / 2, ty: H - 60 };
let score = 0, streak = 0, correct = 0, total = 0;
let speed = 2, teamOn = false;
let peers = new Map();
let lastPos = 0, flashWrong = 0;
let audio = null;

// ─── Auth ────────────────────────────────────────────────────────────────────
async function post(path, body) {
  const r = await fetch(API(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error'); return j;
}
const S = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
};
window.S = S;
function done(t, name) {
  token = t; username = name; localStorage.setItem('sk_token', t);
  $('#loginOv').style.display = 'none'; $('#who').textContent = '👤 ' + name;
  connect(); newRound(true);
}
function connect() {
  socket = io({ path: '/skate/socket.io', auth: { token } });
  socket.on('authError', () => { localStorage.removeItem('sk_token'); location.reload(); });
  socket.on('joined', d => { color = d.color; setTeam(d.teamScore); d.peers.forEach(p => peers.set(p.id, p)); });
  socket.on('peerJoined', p => peers.set(p.id, p));
  socket.on('peerPos', p => { const q = peers.get(p.id); if (q) { q.x = p.x; q.y = p.y; } });
  socket.on('peerLeft', ({ id }) => peers.delete(id));
  socket.on('teamScore', ({ score }) => setTeam(score));
  socket.on('kicked', ({ reason }) => { alert(reason || 'Removed'); location.href = '/'; });
  socket.emit('join');
}

// ─── Round / stars ───────────────────────────────────────────────────────────
function rint(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function distractors(sum) {
  const pool = [sum-1, sum+1, sum-2, sum+2, sum-3, sum+3, sum-4, sum+4, rint(0,18), rint(0,18)]
    .filter(v => v >= 0 && v <= 18 && v !== sum);
  const out = [];
  for (const v of pool.sort(() => Math.random() - 0.5)) { if (!out.includes(v) && out.length < 3) out.push(v); }
  while (out.length < 3) { const v = rint(0,18); if (v !== sum && !out.includes(v)) out.push(v); }
  return out;
}
function newRound(fresh) {
  prob.a = rint(0, 9); prob.b = rint(0, 9); prob.sum = prob.a + prob.b;
  const vals = [prob.sum, ...distractors(prob.sum)].sort(() => Math.random() - 0.5);
  if (fresh || stars.length !== 4) {
    stars = vals.map((val, i) => ({ val, x: rint(60, W - 60), y: 120 + i * 78, vx: dir() }));
  } else {
    stars.forEach((s, i) => { s.val = vals[i]; });   // keep positions, refresh values
  }
  $('#prob').textContent = `${prob.a} + ${prob.b} = ?`;
  updateHud();
}
function dir() { return (Math.random() < 0.5 ? -1 : 1) * (0.6 + speed * 0.5); }
function respawnStar(s) { s.x = s.vx > 0 ? -STAR_R : W + STAR_R; s.y = rint(110, H - 90); }

function grab(s) {
  total++;
  if (s.val === prob.sum) {
    score++; streak++; correct++;
    quack();
    socket && socket.emit('grab', { a: prob.a, b: prob.b, correct: true, streak });
    newRound(false);
  } else {
    streak = 0; flashWrong = performance.now();
    socket && socket.emit('grab', { a: prob.a, b: prob.b, correct: false, streak: 0 });
    // that star bounces away and gets a new wrong value; the problem stays.
    s.x = rint(60, W - 60); s.y = rint(110, H - 90);
    const d = distractors(prob.sum); s.val = d[rint(0, d.length - 1)];
  }
  updateHud();
}
function updateHud() {
  $('#score').textContent = score; $('#streak').textContent = streak;
  $('#acc').textContent = total ? Math.round(correct / total * 100) : 100;
}
function setTeam(v) { if (teamOn) $('#team').textContent = v; window._team = v; }

// ─── Controls ────────────────────────────────────────────────────────────────
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  skater.tx = (e.clientX - r.left) * (W / r.width);
  skater.ty = (e.clientY - r.top) * (H / r.height);
}
canvas.addEventListener('pointermove', toCanvas);
canvas.addEventListener('pointerdown', e => { ensureAudio(); toCanvas(e); });
$('#speed').addEventListener('input', e => { speed = +e.target.value; stars.forEach(s => { s.vx = Math.sign(s.vx) * (0.6 + speed * 0.5); }); });
$('#teamToggle').addEventListener('change', e => {
  teamOn = e.target.checked; $('#teamWrap').style.display = teamOn ? '' : 'none';
  if (teamOn) $('#team').textContent = window._team || 0;
  socket && socket.emit('team', { on: teamOn });
});

// ─── Sound: a synthesized QUACK ──────────────────────────────────────────────
function ensureAudio() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (audio && audio.state === 'suspended') audio.resume(); }
function quack() {
  if (!audio) return;
  const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.16);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.22);
}

// ─── Render loop ─────────────────────────────────────────────────────────────
function frame(ts) {
  requestAnimationFrame(frame);
  // move stars
  for (const s of stars) { s.x += s.vx; if (s.x < -STAR_R - 10 || s.x > W + STAR_R + 10) respawnStar(s); }
  // ease skater toward pointer
  skater.x += (skater.tx - skater.x) * 0.35; skater.y += (skater.ty - skater.y) * 0.35;
  skater.x = Math.max(SKATER_R, Math.min(W - SKATER_R, skater.x));
  skater.y = Math.max(SKATER_R, Math.min(H - SKATER_R, skater.y));
  // collisions
  for (const s of stars) { if (Math.hypot(skater.x - s.x, skater.y - s.y) < SKATER_R + STAR_R - 6) { grab(s); break; } }
  // broadcast position
  if (socket && ts - lastPos > 80) { lastPos = ts; socket.emit('pos', { x: skater.x, y: skater.y }); }

  ctx.clearRect(0, 0, W, H);
  drawRink();
  for (const p of peers.values()) drawSkater(p.x, p.y, p.color || '#89f', p.username, true);
  for (const s of stars) drawStar(s);
  drawSkater(skater.x, skater.y, color, username, false);
  if (performance.now() - flashWrong < 220) { ctx.fillStyle = 'rgba(255,70,90,0.12)'; ctx.fillRect(0, 0, W, H); }
}

function drawRink() {
  ctx.save();
  ctx.fillStyle = '#2a1275'; ctx.beginPath(); ctx.ellipse(W/2, H/2, W/2 - 20, H/2 - 20, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#5a3fd0'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(W/2, H/2, W/2 - 70, H/2 - 60, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}
function drawStar(s) {
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.shadowColor = '#ffe98a'; ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd23f'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI/2 + i * Math.PI/5, r = i % 2 ? STAR_R*0.5 : STAR_R; ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r); }
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#7a4b00'; ctx.font = 'bold 24px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s.val, 0, 1);
  ctx.restore();
}
function drawSkater(x, y, col, name, ghost) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = ghost ? 0.5 : 1;
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -4, SKATER_R, 0, Math.PI*2); ctx.fill();       // body
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-7, -8, 4, 0, Math.PI*2); ctx.arc(7, -8, 4, 0, Math.PI*2); ctx.fill(); // eyes
  ctx.fillStyle = '#241063'; ctx.beginPath(); ctx.arc(-7, -8, 2, 0, Math.PI*2); ctx.arc(7, -8, 2, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#241063'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 7, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke(); // smile
  ctx.fillStyle = '#333'; ctx.fillRect(-SKATER_R*0.8, SKATER_R-6, SKATER_R*1.6, 6);                // skate bar
  ctx.fillStyle = '#ff5aa5'; ctx.beginPath(); ctx.arc(-SKATER_R*0.6, SKATER_R+2, 3, 0, Math.PI*2); ctx.arc(SKATER_R*0.6, SKATER_R+2, 3, 0, Math.PI*2); ctx.fill(); // wheels
  ctx.globalAlpha = ghost ? 0.7 : 1; ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(name || '', 0, -SKATER_R - 8);
  ctx.restore();
}

requestAnimationFrame(frame);

// auto-login with a remembered token
if (token) {
  fetch('/skate/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(me => done(token, me.username))
    .catch(() => localStorage.removeItem('sk_token'));
}
})();
