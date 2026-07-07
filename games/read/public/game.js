'use strict';
/* Rocket Read — client. The server hands us a sentence + which word is blanked
   (never the answer) and grades our guess, so there's nothing to copy. We show the
   full sentence briefly, hide it, then reveal it with the blank to fill. */
(() => {
const $ = s => document.querySelector(s);
const API = p => '/read/api' + p;
let token = localStorage.getItem('rr_token') || '';
let username = '', color = '#ffd23f';
let socket = null, audio = null;

const canvas = $('#c'), ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const stars = Array.from({ length: 90 }, () => ({ x: Math.random()*W, y: Math.random()*H, z: Math.random()*2+0.4 }));

let round = null;          // { words, blankIndex, displayMs }
let phase = 'idle';        // idle | read | answer | result
let score = 0, streak = 0, correct = 0, total = 0, speed = 3;
let myHeight = 0, peers = new Map();
let readTimer = null, tEnd = 0;

// ── Auth ─────────────────────────────────────────────────────────────────────
async function post(path, body) {
  const r = await fetch(API(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error'); return j;
}
const R = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
  submit() { submit(); },
};
window.R = R;
function done(t, name) {
  token = t; username = name; localStorage.setItem('rr_token', t);
  $('#loginOv').style.display = 'none'; $('#who').textContent = '👤 ' + name;
  connect();
}
function connect() {
  socket = io({ path: '/read/socket.io', auth: { token } });
  socket.on('authError', () => { localStorage.removeItem('rr_token'); location.reload(); });
  socket.on('joined', d => { color = d.color; d.peers.forEach(p => peers.set(p.id, p)); nextRound(); });
  socket.on('peerJoined', p => peers.set(p.id, p));
  socket.on('peerHeight', p => { const q = peers.get(p.id); if (q) q.height = p.height; });
  socket.on('peerLeft', ({ id }) => peers.delete(id));
  socket.on('round', startRound);
  socket.on('result', showResult);
  socket.on('kicked', ({ reason }) => { alert(reason || 'Removed'); location.href = '/'; });
  socket.emit('join');
}

// ── Round flow ───────────────────────────────────────────────────────────────
function nextRound() { $('#answerRow').hidden = true; $('#feedback').textContent = ''; $('#sentence').textContent = 'Get ready to read…'; setTimeout(() => socket.emit('newRound'), 700); }
function startRound(r) {
  round = r; phase = 'read';
  $('#answerRow').hidden = true; $('#feedback').textContent = '';
  $('#sentence').innerHTML = r.words.map(escapeWord).join(' ');
  // brief display, scaled by the reading-time dial (higher = shorter)
  const ms = Math.max(1400, r.displayMs * (1.4 - speed * 0.18));
  tEnd = performance.now() + ms;
  clearTimeout(readTimer); readTimer = setTimeout(showBlank, ms);
}
function showBlank() {
  phase = 'answer';
  $('#timerBar').style.width = '0%';
  $('#sentence').innerHTML = round.words.map((w, i) => i === round.blankIndex ? '<span class="blank">?</span>' : escapeWord(w)).join(' ');
  $('#answerRow').hidden = false; const inp = $('#answer'); inp.value = ''; inp.focus();
}
function submit() {
  if (phase !== 'answer') return;
  const g = $('#answer').value.trim(); if (!g) return;
  phase = 'result'; total++;
  socket.emit('answer', { guess: g });
}
function showResult({ correct: ok, answer }) {
  const fb = $('#feedback'); $('#answerRow').hidden = true;
  if (ok) {
    correct++; score++; streak++; myHeight++; ding(); whoosh();
    fb.style.color = '#7be06a'; fb.textContent = '✅ Blast off! 🚀';
  } else {
    streak = 0; fb.style.color = '#ff9db0'; fb.textContent = `❌ Try again — the word was “${answer}”`;
  }
  updateHud();
  setTimeout(nextRound, ok ? 700 : 1400);
}
function updateHud() { $('#score').textContent = myHeight; $('#streak').textContent = streak; $('#acc').textContent = total ? Math.round(correct/total*100) : 100; }
function escapeWord(w) { return String(w).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
$('#speed').addEventListener('input', e => { speed = +e.target.value; });

// ── Sound ────────────────────────────────────────────────────────────────────
function ensureAudio() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (audio && audio.state === 'suspended') audio.resume(); }
function ding() { if (!audio) return; const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(880,t); o.frequency.setValueAtTime(1320,t+0.09); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.3,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.3); o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t+0.32); }
function whoosh() { if (!audio) return; const t = audio.currentTime, len = 0.4; const buf = audio.createBuffer(1, audio.sampleRate*len, audio.sampleRate); const d = buf.getChannelData(0); for (let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length); const src = audio.createBufferSource(); src.buffer=buf; const f=audio.createBiquadFilter(); f.type='bandpass'; f.frequency.setValueAtTime(500,t); f.frequency.exponentialRampToValueAtTime(2600,t+len); const g=audio.createGain(); g.gain.setValueAtTime(0.25,t); g.gain.exponentialRampToValueAtTime(0.001,t+len); src.connect(f); f.connect(g); g.connect(audio.destination); src.start(t); }

// ── Render (rocket race) ─────────────────────────────────────────────────────
function rocketY(height) { return H - 26 - ((height % 12) * (H - 70) / 12); }
function frame() {
  requestAnimationFrame(frame);
  ctx.fillStyle = '#080322'; ctx.fillRect(0, 0, W, H);
  for (const s of stars) { s.y += s.z * 0.6; if (s.y > H) { s.y = 0; s.x = Math.random()*W; } ctx.fillStyle = `rgba(255,255,255,${0.3+s.z*0.3})`; ctx.fillRect(s.x, s.y, s.z, s.z); }
  const others = [...peers.values()];
  const n = others.length + 1, laneW = W / (n + 1);
  drawRocket(laneW, rocketY(myHeight), color, username + ' (you)', myHeight, true);
  others.forEach((p, i) => drawRocket(laneW * (i + 2), rocketY(p.height || 0), p.color || '#89f', p.username, p.height || 0, false));
  // read-phase timer bar
  if (phase === 'read') { const left = Math.max(0, tEnd - performance.now()); $('#timerBar').style.width = Math.min(100, left / 22) + '%'; }
}
function drawRocket(x, y, col, name, h, you) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = you ? 1 : 0.75;
  if (phase !== 'answer') { ctx.fillStyle = 'rgba(255,150,60,.8)'; ctx.beginPath(); ctx.moveTo(-6, 20); ctx.lineTo(0, 20 + 14 + Math.random()*8); ctx.lineTo(6, 20); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -22); ctx.quadraticCurveTo(13, -4, 11, 18); ctx.lineTo(-11, 18); ctx.quadraticCurveTo(-13, -4, 0, -22); ctx.fill();
  ctx.fillStyle = '#05010f'; ctx.beginPath(); ctx.arc(0, -2, 5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-11,18); ctx.lineTo(-18,26); ctx.lineTo(-11,10); ctx.closePath(); ctx.moveTo(11,18); ctx.lineTo(18,26); ctx.lineTo(11,10); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = '#eaf0ff'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${name} · ${h}`, 0, -30);
  ctx.restore();
}
requestAnimationFrame(frame);

// auto-login
if (token) {
  fetch('/read/api/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(me => done(token, me.username))
    .catch(() => localStorage.removeItem('rr_token'));
}
})();
