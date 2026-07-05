'use strict';
/* Typing Train — client engine.
   Gameplay runs here for responsiveness; the server persists stats, relays live
   peer positions, and serves ghost laps. Drawing is code-based but isolated in
   draw* helpers so raster art can replace it later. */
(() => {
const $ = s => document.querySelector(s);
const API = p => '/typing/api' + p;
let token = localStorage.getItem('tt_token') || '';
let username = '';
let meta = null;         // /api/levels
let unlocked = 1;        // highest level unlocked
let socket = null;

const canvas = $('#c'), ctx = canvas.getContext('2d');
const KB_LAYOUT = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./', ' '];
const FINGER_NAME = { Lpinky:'left pinky', Lring:'left ring', Lmid:'left middle', Lindex:'left index',
  Rindex:'right index', Rmid:'right middle', Rring:'right ring', Rpinky:'right pinky', Thumb:'thumb' };

// ── Active game state ────────────────────────────────────────────────────────
let G = null;
function newGame(level, seq, ghost) {
  return {
    level, seq, N: seq.length,
    pos: 0, displayPos: 0,
    targetShownAt: performance.now(),
    lap: freshLap(),
    intervals: [],           // recent ms between correct keys (for wpm)
    lastKeyAt: performance.now(),
    acc: { correct: 0, incorrect: 0 },
    wheel: 0, ground: 0, steam: [],
    peers: new Map(),        // id -> {color, seg, frac, wpm, username}
    ghost, ghostStart: performance.now(),
    running: true, lastPos: performance.now(),
  };
}
function freshLap() { return { start: performance.now(), splits: [], correct: 0, incorrect: 0, perKey: {} }; }
function target() { return G.seq[G.pos % G.N]; }
function bump(key, field) { (G.lap.perKey[key] ||= { presented:0, correct:0, incorrect:0, time:0 })[field]++; }

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authPost(path, body) {
  const r = await fetch(API(path), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const TT = {
  async login() {
    try { const j = await authPost('/login', { username:$('#u').value.trim(), password:$('#p').value });
      finishAuth(j.token, j.username); } catch(e){ $('#loginErr').textContent = e.message; }
  },
  async register() {
    try { const j = await authPost('/register', { username:$('#u').value.trim(), password:$('#p').value });
      finishAuth(j.token, j.username); } catch(e){ $('#loginErr').textContent = e.message; }
  },
};
window.TT = TT;
function finishAuth(t, name) {
  token = t; username = name; localStorage.setItem('tt_token', t);
  $('#loginOv').style.display = 'none'; $('#who').textContent = '👤 ' + name; $('#menuBtn').style.display = '';
  boot();
}

async function boot() {
  meta = await (await fetch(API('/levels'))).json();
  const prog = await (await fetch(API('/progress'), { headers:{ Authorization:'Bearer '+token } })).json();
  unlocked = prog.level || 1;
  connectSocket();
  buildKeyboard();
  showLevels();
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ path:'/typing/socket.io', auth:{ token } });
  socket.on('authError', () => { localStorage.removeItem('tt_token'); location.reload(); });
  socket.on('joined', ({ peers }) => { if (G) peers.forEach(p => G.peers.set(p.id, p)); });
  socket.on('peerJoined', p => { if (G) G.peers.set(p.id, p); });
  socket.on('peerPos', p => { if (G && G.peers.has(p.id)) Object.assign(G.peers.get(p.id), p); });
  socket.on('peerLeft', ({ id }) => { if (G) G.peers.delete(id); });
  socket.on('lapSaved', d => onLapSaved(d));
  socket.on('kicked', ({ reason }) => { alert(reason || 'Removed'); location.href = '/'; });
}

// ── Level select ─────────────────────────────────────────────────────────────
function showLevels() {
  G && (G.running = false);
  const grid = $('#levelGrid'); grid.innerHTML = '';
  meta.list.forEach(l => {
    const b = document.createElement('button');
    b.className = 'lvl'; b.disabled = l.level > unlocked;
    b.innerHTML = `<div class="n">${l.level}. ${l.name}</div><div class="k">${l.keys.join(' ')}</div>`;
    b.onclick = () => startLevel(l.level);
    grid.appendChild(b);
  });
  const s = document.createElement('button');
  s.className = 'lvl story'; s.disabled = unlocked < meta.storyLevel;
  s.innerHTML = `<div class="n">📖 Story Mode</div><div class="k">${unlocked<meta.storyLevel?'locked — finish the drills':'type real stories'}</div>`;
  s.onclick = () => startStory();
  grid.appendChild(s);
  $('#levelOv').style.display = 'flex';
}
$('#menuBtn').onclick = showLevels;

async function startLevel(level) {
  $('#levelOv').style.display = 'none';
  const t = await (await fetch(API('/track?level='+level), { headers:{ Authorization:'Bearer '+token } })).json();
  $('#hudLevel').textContent = `Lvl ${level}: ${t.name}`;
  $('#hudBest').textContent = t.ghost ? (t.ghost.lapMs/1000).toFixed(1)+'s' : '—';
  G = newGame(level, t.segmentsText, t.ghost);
  (t.peers||[]).forEach(p => { if (p.id !== socket.id) G.peers.set(p.id, p); });
  socket.emit('join', { level });
  refreshTarget(true);
}
async function startStory() {
  const stories = await (await fetch(API('/stories'), { headers:{ Authorization:'Bearer '+token } })).json();
  const grid = $('#levelGrid'); grid.innerHTML = '';
  const back = document.createElement('button'); back.className = 'lvl';
  back.innerHTML = '<div class="n">← Back to levels</div>'; back.onclick = showLevels; grid.appendChild(back);
  if (!stories.length) { const d = document.createElement('div'); d.className='muted'; d.textContent='No stories yet — ask your teacher to add one.'; grid.appendChild(d); }
  stories.forEach(st => {
    const b = document.createElement('button'); b.className = 'lvl story';
    b.innerHTML = `<div class="n">📖 ${esc(st.title)}</div><div class="k">${st.author?esc(st.author)+' · ':''}grade ${st.grade_level}</div>`;
    b.onclick = () => beginStory(st.id); grid.appendChild(b);
  });
  $('#levelOv').style.display = 'flex';
}
async function beginStory(id) {
  $('#levelOv').style.display = 'none';
  const st = await (await fetch(API('/story/'+id), { headers:{ Authorization:'Bearer '+token } })).json();
  const chars = normalizeStory(st.body);
  const level = meta.storyLevel, SEG = meta.segmentsPerLap;
  G = newGame(level, chars.slice(0, SEG), null);
  G.story = { id, title: st.title, chars, ptr: 0, total: chars.length };
  socket.emit('join', { level });
  updateStoryHud();
  refreshTarget(true);
}
function normalizeStory(text) {
  return text.toLowerCase()
    .replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[—–]/g,'-')
    .replace(/\s+/g,' ').trim()
    .split('').filter(c => /[a-z0-9 ,.;'/-]/.test(c));
}
function updateStoryHud() {
  const pct = Math.min(100, Math.round(G.story.ptr / G.story.total * 100));
  $('#hudLevel').textContent = `📖 ${G.story.title} — ${pct}%`;
  $('#hudBest').textContent = '—';
}
function advanceStory() {
  const SEG = meta.segmentsPerLap;
  G.story.ptr += G.N;
  if (G.story.ptr >= G.story.total) {
    G.running = false;
    setTimeout(() => { alert('🎉 Story complete — great typing!'); startStory(); }, 60);
    return;
  }
  G.seq = G.story.chars.slice(G.story.ptr, G.story.ptr + SEG);
  G.N = G.seq.length; G.pos = 0; G.displayPos = 0;
  updateStoryHud();
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!G || !G.running) return;
  if (e.key === 'Escape') { showLevels(); return; }
  if (e.key.length !== 1) return;          // ignore Shift, arrows, etc.
  const ch = e.key.toLowerCase();
  const tgt = (target() || '').toLowerCase();
  e.preventDefault();
  if (ch === tgt) correctHit(); else wrongHit(target());
});

function refreshTarget(first) {
  G.targetShownAt = performance.now();
  (G.lap.perKey[target()] ||= { presented:0, correct:0, incorrect:0, time:0 }).presented++;
  highlightKey(target());
}

function correctHit() {
  const now = performance.now();
  const key = target();
  const dt = now - G.targetShownAt;
  const pk = (G.lap.perKey[key] ||= { presented:0, correct:0, incorrect:0, time:0 });
  pk.correct++; pk.time += dt;
  G.lap.correct++; G.acc.correct++;
  // wpm smoothing
  G.intervals.push(now - G.lastKeyAt); if (G.intervals.length > 8) G.intervals.shift();
  G.lastKeyAt = now;
  spawnSteam();

  G.pos++;
  G.lap.splits.push(Math.round(now - G.lap.start));
  if (G.pos % G.N === 0) completeLap();
  refreshTarget();
}
function wrongHit(tgt) {
  bump(tgt, 'incorrect'); G.lap.incorrect++; G.acc.incorrect++;
  flashWrong();
}
function completeLap() {
  const now = performance.now();
  const lapMs = Math.round(now - G.lap.start);
  socket.emit('lap', { level: G.level, lapMs, splits: G.lap.splits,
    perKey: G.lap.perKey, correct: G.lap.correct, incorrect: G.lap.incorrect,
    storyId: G.story ? G.story.id : undefined });
  $('#hudLap').textContent = (lapMs/1000).toFixed(1);
  G.lap = freshLap();
  G.ghostStart = now;   // restart ghost each lap
  if (G.story) advanceStory();
}
function onLapSaved(d) {
  if (d.unlockedLevel > unlocked) unlocked = d.unlockedLevel;
  if (d.best) $('#hudBest').textContent = (d.best.lapMs/1000).toFixed(1)+'s';
}

// ── wpm / speed ──────────────────────────────────────────────────────────────
function currentWpm() {
  if (!G.intervals.length) return 0;
  const avg = G.intervals.reduce((a,b)=>a+b,0) / G.intervals.length;   // ms/char
  if (avg <= 0) return 0;
  return Math.round((1000 / avg) * 60 / 5);   // chars/sec → wpm
}

// ── On-screen keyboard ───────────────────────────────────────────────────────
function buildKeyboard() {
  const kb = $('#kb'); kb.innerHTML = '';
  KB_LAYOUT.forEach(rowStr => {
    const row = document.createElement('div'); row.className = 'krow';
    for (const ch of rowStr) {
      const k = document.createElement('div');
      const fin = meta.finger[ch] || '';
      k.className = 'key ' + fin + (ch === ' ' ? ' wide' : '');
      k.dataset.k = ch; k.textContent = ch === ' ' ? 'space' : ch;
      row.appendChild(k);
    }
    kb.appendChild(row);
  });
}
function highlightKey(ch) {
  document.querySelectorAll('.key.next').forEach(k => k.classList.remove('next'));
  const k = document.querySelector('.key[data-k="'+(ch===' '?' ':cssEsc(ch))+'"]');
  if (k) k.classList.add('next');
  const fin = meta.finger[ch];
  $('#fingerHint').textContent = fin ? `“${ch===' '?'space':ch}” — ${FINGER_NAME[fin]}` : '';
}
function cssEsc(c){ return (window.CSS && CSS.escape) ? CSS.escape(c) : c.replace(/["\\]/g,'\\$&'); }
let wrongFlash = 0;
function flashWrong(){ wrongFlash = performance.now(); }

// ── Rendering ────────────────────────────────────────────────────────────────
const TRACK = { cx: 460, cy: 150, rx: 380, ry: 108 };
function trackPoint(t) {           // t in [0,N) → {x,y,ang}
  const a = (t / G.N) * Math.PI * 2 - Math.PI / 2;
  return { x: TRACK.cx + Math.cos(a) * TRACK.rx, y: TRACK.cy + Math.sin(a) * TRACK.ry, ang: a };
}
function spawnSteam(){ G.steam.push({ x: 250, y: 360, r: 4, life: 1 }); }

function frame(ts) {
  requestAnimationFrame(frame);
  if (!G) return;
  // ease train toward pos
  G.displayPos += (G.pos - G.displayPos) * 0.2;
  const wpm = currentWpm();
  G.wheel += 0.02 + wpm * 0.004;
  G.ground = (G.ground + 1 + wpm * 0.15) % 40;
  $('#hudWpm').textContent = wpm;
  const tot = G.acc.correct + G.acc.incorrect;
  $('#hudAcc').textContent = tot ? Math.round(G.acc.correct / tot * 100) : 100;

  // throttled position broadcast
  if (ts - G.lastPos > 90) { G.lastPos = ts;
    socket.emit('pos', { seg: Math.floor(G.displayPos) % G.N, frac: G.displayPos % 1, wpm });
  }

  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawTopTrack();
  drawScene(wpm);
}

function drawTopTrack() {
  // rail bed (oval)
  ctx.save();
  ctx.strokeStyle = '#33406b'; ctx.lineWidth = 26; ctx.beginPath();
  ctx.ellipse(TRACK.cx, TRACK.cy, TRACK.rx, TRACK.ry, 0, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#5566aa'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(TRACK.cx, TRACK.cy, TRACK.rx+9, TRACK.ry+9, 0, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(TRACK.cx, TRACK.cy, TRACK.rx-9, TRACK.ry-9, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  // segment letters
  for (let i = 0; i < G.N; i++) {
    const p = trackPoint(i);
    const isTarget = (i === G.pos % G.N);
    ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI*2);
    ctx.fillStyle = isTarget ? '#ffcc33' : '#12203f';
    ctx.fill(); ctx.strokeStyle = isTarget ? '#fff2b0' : '#3a4a78'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = isTarget ? '#1a1200' : '#cdd8f5'; ctx.font = 'bold 15px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(G.seq[i] === ' ' ? '␣' : G.seq[i], p.x, p.y+1);
  }
  // ghost
  if (G.ghost && G.ghost.splits && G.ghost.splits.length) drawGhost();
  // peers
  for (const pr of G.peers.values()) drawMarker((pr.seg||0) + (pr.frac||0), pr.color || '#8899cc', pr.username, false);
  // you
  drawMarker(G.displayPos, '#ffcc33', username, true);
}
function drawGhost() {
  const elapsed = (performance.now() - G.ghostStart) % (G.ghost.lapMs || 1);
  const sp = G.ghost.splits; let seg = 0;
  while (seg < sp.length && sp[seg] <= elapsed) seg++;
  const prevT = seg>0 ? sp[seg-1] : 0, nextT = sp[seg] ?? (G.ghost.lapMs||1);
  const frac = nextT>prevT ? (elapsed - prevT)/(nextT - prevT) : 0;
  drawMarker(seg + frac, 'rgba(200,220,255,0.5)', 'ghost', false, true);
}
function drawMarker(t, color, label, isYou, ghost) {
  const p = trackPoint(t % G.N);
  ctx.save();
  ctx.globalAlpha = ghost ? 0.6 : 1;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.x, p.y, isYou?9:7, 0, Math.PI*2); ctx.fill();
  if (isYou){ ctx.fillStyle='#1a1200'; ctx.font='10px system-ui'; ctx.textAlign='center'; ctx.fillText('🚂', p.x, p.y+3); }
  ctx.globalAlpha = 1; ctx.fillStyle = ghost?'#aab':'#cdd8f5'; ctx.font='10px system-ui'; ctx.textAlign='center';
  ctx.fillText(label || '', p.x, p.y - 12);
  ctx.restore();
}

function drawScene(wpm) {
  const groundY = 400;
  // sky/ground
  ctx.fillStyle = '#0e1630'; ctx.fillRect(0, 300, canvas.width, canvas.height-300);
  ctx.fillStyle = '#182247'; ctx.fillRect(0, groundY, canvas.width, canvas.height-groundY);
  // moving rails
  ctx.strokeStyle = '#3a4a78'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, groundY+18); ctx.lineTo(canvas.width, groundY+18); ctx.stroke();
  ctx.strokeStyle = '#4a5a90'; ctx.lineWidth = 4;
  for (let x = -40 + G.ground; x < canvas.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, groundY+10); ctx.lineTo(x, groundY+26); ctx.stroke(); }
  // steam puffs
  ctx.save();
  for (const s of G.steam) { s.life -= 0.02; s.y -= 0.7 + wpm*0.02; s.x -= 0.6; s.r += 0.4;
    ctx.globalAlpha = Math.max(0, s.life)*0.7; ctx.fillStyle = '#dfe7ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); }
  G.steam = G.steam.filter(s => s.life > 0);
  ctx.restore();
  drawLocomotive(230, groundY, G.wheel);
  // wrong flash
  if (performance.now() - wrongFlash < 200) { ctx.fillStyle = 'rgba(255,60,80,0.18)'; ctx.fillRect(0,300,canvas.width,canvas.height-300); }
  // current target big
  ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 64px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(target() === ' ' ? '␣' : target(), 620, 360);
  ctx.fillStyle = '#8fa6d8'; ctx.font = '14px system-ui'; ctx.fillText('type this', 620, 405);
}

// Code-drawn steam locomotive (profile). Isolated so raster art can replace it.
function drawLocomotive(x, baseY, wheelPhase) {
  ctx.save();
  ctx.translate(x, baseY);
  // body
  ctx.fillStyle = '#2b6cb0'; roundRect(-90, -60, 120, 46, 8); ctx.fill();       // cab
  ctx.fillStyle = '#22537f'; roundRect(-30, -46, 96, 34, 16); ctx.fill();       // boiler
  ctx.beginPath(); ctx.arc(66, -29, 17, -Math.PI/2, Math.PI/2); ctx.fill();     // boiler front
  ctx.fillStyle = '#12324d'; ctx.fillRect(58, -46, 8, 34);                      // smokebox door ring
  // funnel
  ctx.fillStyle = '#1c3d5c'; ctx.fillRect(30, -74, 16, 30); ctx.fillRect(26, -80, 24, 8);
  // cab window + roof
  ctx.fillStyle = '#0e1c2c'; ctx.fillRect(-78, -50, 26, 22);
  ctx.fillStyle = '#173a57'; ctx.fillRect(-96, -64, 44, 8);
  // dome + whistle
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(6, -48, 8, Math.PI, 0); ctx.fill();
  // running board
  ctx.fillStyle = '#0f2438'; ctx.fillRect(-92, -14, 168, 8);
  // cow-catcher
  ctx.fillStyle = '#0f2438'; ctx.beginPath(); ctx.moveTo(76,-6); ctx.lineTo(96,10); ctx.lineTo(76,10); ctx.closePath(); ctx.fill();
  // wheels
  drawWheel(-64, 10, 16, wheelPhase);
  drawWheel(-20, 10, 22, wheelPhase);
  drawWheel(34, 10, 22, wheelPhase);
  ctx.restore();
}
function drawWheel(x, y, r, phase) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(phase);
  ctx.fillStyle = '#0b1a29'; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#5a7fb0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#3a5680'; ctx.lineWidth = 2;
  for (let i=0;i<6;i++){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(i*Math.PI/3)*r, Math.sin(i*Math.PI/3)*r); ctx.stroke(); }
  ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

requestAnimationFrame(frame);

// auto-login if we have a token
if (token) {
  fetch(API('/me'), { headers:{ Authorization:'Bearer '+token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(me => finishAuth(token, me.username))
    .catch(() => { localStorage.removeItem('tt_token'); });
}
})();
