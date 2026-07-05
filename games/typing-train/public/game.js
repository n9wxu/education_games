'use strict';
/* Typing Train — client engine.
   Letters ride the track toward the locomotive at the player's current typing
   rate; you must type each letter before the train reaches it. A struck letter
   is a miss. A level is 3 laps; clear it with accuracy > 90% and speed > 80 wpm.
   Gameplay runs here; the server persists stats, relays live peers, serves ghosts.
   Drawing is code-based but isolated in draw* helpers so raster art can replace it. */
(() => {
const $ = s => document.querySelector(s);
const API = p => '/typing/api' + p;
let token = localStorage.getItem('tt_token') || '';
let username = '';
let meta = null;
let unlocked = 1;
let socket = null;

const canvas = $('#c'), ctx = canvas.getContext('2d');
const KB_LAYOUT = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./', ' '];
const FINGER_NAME = { Lpinky:'left pinky', Lring:'left ring', Lmid:'left middle', Lindex:'left index',
  Rindex:'right index', Rmid:'right middle', Rring:'right ring', Rpinky:'right pinky', Thumb:'thumb' };

const LAPS = 3, PASS_ACC = 0.90, PASS_WPM = 30;   // level = 3 laps; pass thresholds
const LEAD = 6;          // letters of runway between the loco and the next letter
const FLOOR_LPS = 0.6;   // minimum approach speed (letters/sec) so the train always creeps
const XLOCO = 230, STEP = 54;   // strip geometry

// ── Active game state ────────────────────────────────────────────────────────
let G = null;
function newGame(level, seq, ghost) {
  const now = performance.now();
  return {
    level, seq, N: seq.length,
    pos: 0, trainPos: 0, rateLPS: FLOOR_LPS, lastTs: now,
    targetShownAt: now, lastKeyAt: now, intervals: [],
    lap: freshLap(), run: { correct: 0, incorrect: 0, start: now },
    acc: { correct: 0, incorrect: 0 },
    wheel: 0, steam: [], peers: new Map(),
    ghost, ghostStart: now, story: null, running: true, lastPos: now,
  };
}
function freshLap() { return { start: performance.now(), splits: [], correct: 0, incorrect: 0, perKey: {} }; }
function curChar() { return G.seq[G.pos % G.N]; }
function limit() { return G.story ? G.N : G.N * LAPS; }
function windowChar(g) {           // global letter index → char (key loops; story is linear)
  if (G.story) return (g >= 0 && g < G.N) ? G.seq[g] : null;
  return G.seq[((g % G.N) + G.N) % G.N];
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authPost(path, body) {
  const r = await fetch(API(path), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || 'Error'); return j;
}
const TT = {
  async login()    { try { const j = await authPost('/login',    { username:$('#u').value.trim(), password:$('#p').value }); finishAuth(j.token, j.username); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { try { const j = await authPost('/register', { username:$('#u').value.trim(), password:$('#p').value }); finishAuth(j.token, j.username); } catch(e){ $('#loginErr').textContent = e.message; } },
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
  connectSocket(); buildKeyboard(); wireDone(); showLevels();
}
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ path:'/typing/socket.io', auth:{ token } });
  socket.on('authError', () => { localStorage.removeItem('tt_token'); location.reload(); });
  socket.on('joined', ({ peers }) => { if (G) peers.forEach(p => G.peers.set(p.id, p)); });
  socket.on('peerJoined', p => { if (G) G.peers.set(p.id, p); });
  socket.on('peerPos', p => { if (G && G.peers.has(p.id)) Object.assign(G.peers.get(p.id), p); else if (G) G.peers.set(p.id, p); });
  socket.on('peerLeft', ({ id }) => { if (G) G.peers.delete(id); });
  socket.on('lapSaved', d => { if (d.unlockedLevel > unlocked) unlocked = d.unlockedLevel; });
  socket.on('kicked', ({ reason }) => { alert(reason || 'Removed'); location.href = '/'; });
}

// ── Level / story select ─────────────────────────────────────────────────────
function showLevels() {
  G && (G.running = false);
  const grid = $('#levelGrid'); grid.innerHTML = '';
  meta.list.forEach(l => {
    const b = document.createElement('button');
    b.className = 'lvl'; b.disabled = l.level > unlocked;
    b.innerHTML = `<div class="n">${l.level}. ${l.name}</div><div class="k">${l.keys.join(' ')} · ${l.segments}×3 laps</div>`;
    b.onclick = () => startLevel(l.level);
    grid.appendChild(b);
  });
  const s = document.createElement('button');
  s.className = 'lvl story'; s.disabled = unlocked < meta.storyLevel;
  s.innerHTML = `<div class="n">📖 Story Mode</div><div class="k">${unlocked<meta.storyLevel?'locked — finish the drills':'type real stories'}</div>`;
  s.onclick = () => startStory();
  grid.appendChild(s);
  $('#levelOv').style.display = 'flex'; $('#doneOv').style.display = 'none';
}
$('#menuBtn').onclick = showLevels;

async function startLevel(level) {
  $('#levelOv').style.display = 'none'; $('#doneOv').style.display = 'none';
  const t = await (await fetch(API('/track?level='+level), { headers:{ Authorization:'Bearer '+token } })).json();
  $('#hudLevel').textContent = `Lvl ${level}: ${t.name}`;
  $('#hudBest').textContent = t.ghost ? (t.ghost.lapMs/1000).toFixed(1)+'s' : '—';
  G = newGame(level, t.segmentsText, t.ghost);
  (t.peers||[]).forEach(p => { if (p.id !== socket.id) G.peers.set(p.id, p); });
  socket.emit('join', { level });
  setTarget();
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
  $('#levelOv').style.display = 'flex'; $('#doneOv').style.display = 'none';
}
async function beginStory(id) {
  $('#levelOv').style.display = 'none';
  const st = await (await fetch(API('/story/'+id), { headers:{ Authorization:'Bearer '+token } })).json();
  const saved = await (await fetch(API('/book/'+id), { headers:{ Authorization:'Bearer '+token } })).json().catch(()=>({paraIndex:0}));
  const paras = splitParagraphs(st.body);
  let para = saved.paraIndex || 0; if (para >= paras.length) para = 0;
  G = newGame(meta.storyLevel, paras[para], null);
  G.story = { id, title: st.title, paras, para };
  socket.emit('join', { level: meta.storyLevel });
  updateStoryHud(); setTarget();
}
function splitParagraphs(body) { return body.split(/\n\s*\n/).map(normalizeChars).filter(a => a.length); }
function normalizeChars(text) {
  return text.toLowerCase().replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[—–]/g,'-')
    .replace(/\s+/g,' ').trim().split('').filter(c => /[a-z0-9 ,.;'/-]/.test(c));
}
function updateStoryHud() {
  const b = G.story;
  $('#hudLevel').textContent = `📖 ${b.title} — ¶ ${b.para+1}/${b.paras.length}`;
  $('#hudBest').textContent = '—';
}
function advanceStory() {
  const b = G.story; b.para++;
  if (b.para >= b.paras.length) {
    G.running = false;
    setTimeout(() => { alert('🎉 You finished the story — wonderful typing!'); startStory(); }, 60);
    return;
  }
  G.seq = b.paras[b.para]; G.N = G.seq.length; G.pos = 0; G.trainPos = 0;
  updateStoryHud(); setTarget();
}

// ── Core resolution ──────────────────────────────────────────────────────────
function setTarget() {
  G.targetShownAt = performance.now();
  (G.lap.perKey[curChar()] ||= { presented:0, correct:0, incorrect:0, time:0 }).presented++;
  highlightKey(curChar());
}
function resolveLetter(hit) {
  const now = performance.now(); const ch = curChar();
  const pk = (G.lap.perKey[ch] ||= { presented:0, correct:0, incorrect:0, time:0 });
  if (hit) {
    pk.correct++; pk.time += now - G.targetShownAt; G.lap.correct++; G.run.correct++; G.acc.correct++;
    G.intervals.push(now - G.lastKeyAt); if (G.intervals.length > 10) G.intervals.shift(); G.lastKeyAt = now;
    spawnSteam();
  } else {
    pk.incorrect++; G.lap.incorrect++; G.run.incorrect++; G.acc.incorrect++; flashWrong();
  }
  G.lap.splits.push(Math.round(now - G.lap.start));
  G.pos++;
  if (G.pos % G.N === 0) onLapBoundary(); else setTarget();
}
function misstroke() {
  const ch = curChar();
  (G.lap.perKey[ch] ||= { presented:0, correct:0, incorrect:0, time:0 }).incorrect++;
  G.lap.incorrect++; G.run.incorrect++; G.acc.incorrect++; flashWrong();
}
function runWpm(now) { return (G.run.correct / 5) / Math.max(1e-6, (now - G.run.start) / 60000); }
function onLapBoundary() {
  const now = performance.now();
  const lapMs = Math.round(now - G.lap.start);
  const isFinal = !G.story && (G.pos >= G.N * LAPS);
  const acc = G.run.correct / Math.max(1, G.run.correct + G.run.incorrect);
  const wpm = runWpm(now);
  socket.emit('lap', {
    level: G.level, lapMs, splits: G.lap.splits, perKey: G.lap.perKey,
    correct: G.lap.correct, incorrect: G.lap.incorrect,
    storyId: G.story ? G.story.id : undefined,
    paraIndex: G.story ? G.story.para + 1 : undefined,
    final: isFinal || undefined, runWpm: isFinal ? wpm : undefined, runAcc: isFinal ? acc : undefined,
  });
  $('#hudLap').textContent = (lapMs/1000).toFixed(1);
  G.lap = freshLap();
  if (G.story) { advanceStory(); return; }
  if (isFinal) { finishLevel(acc, wpm); return; }
  setTarget();
}
function finishLevel(acc, wpm) {
  G.running = false;
  const passed = acc > PASS_ACC && wpm > PASS_WPM;
  $('#doneTitle').textContent = passed ? '🎉 Level cleared!' : 'Keep practicing!';
  $('#doneBody').innerHTML =
    `<div>Accuracy: <b>${Math.round(acc*100)}%</b> ${acc>PASS_ACC?'✅':'&nbsp;— need &gt; 90%'}</div>
     <div style="margin-top:4px">Speed: <b>${Math.round(wpm)} wpm</b> ${wpm>PASS_WPM?'✅':'&nbsp;— need &gt; '+PASS_WPM+' wpm'}</div>
     <div class="muted" style="margin-top:10px">${passed?'Next level unlocked!':'Meet both targets over the 3 laps to unlock the next level.'}</div>`;
  const next = $('#doneNext');
  next.style.display = passed ? '' : 'none';
  next.textContent = (G.level >= meta.keyLevelCount) ? 'Story Mode →' : 'Next level →';
  $('#doneOv').style.display = 'flex';
}
function wireDone() {
  $('#doneRetry').onclick = () => startLevel(G.level);
  $('#doneMenu').onclick  = () => showLevels();
  $('#doneNext').onclick  = () => { const nl = G.level + 1; nl > meta.keyLevelCount ? startStory() : startLevel(nl); };
}

// ── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!G || !G.running) return;
  if (e.key === 'Escape') { showLevels(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();
  const ch = e.key.toLowerCase();
  if (ch === (curChar() || '').toLowerCase()) resolveLetter(true); else misstroke();
});

// ── On-screen keyboard ───────────────────────────────────────────────────────
function buildKeyboard() {
  const kb = $('#kb'); kb.innerHTML = '';
  KB_LAYOUT.forEach(rowStr => {
    const row = document.createElement('div'); row.className = 'krow';
    for (const ch of rowStr) {
      const k = document.createElement('div');
      k.className = 'key ' + (meta.finger[ch] || '') + (ch === ' ' ? ' wide' : '');
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

// ── Update + render ──────────────────────────────────────────────────────────
function frame(ts) {
  requestAnimationFrame(frame);
  if (!G) return;
  const wpm = currentWpm();
  if (G.running) {
    const dt = Math.min(0.05, (ts - G.lastTs) / 1000); G.lastTs = ts;
    G.rateLPS = Math.max(FLOOR_LPS, G.intervals.length ? 1000 / (G.intervals.reduce((a,b)=>a+b,0)/G.intervals.length) : FLOOR_LPS);
    G.trainPos += G.rateLPS * dt;
    // any letter the loco has reached without being typed is a miss
    let guard = 0;
    while (G.running && G.pos < limit() && G.trainPos >= G.pos + LEAD && guard++ < 100) resolveLetter(false);
  } else { G.lastTs = ts; }
  G.wheel += 0.03 + G.rateLPS * 0.05;
  const tot = G.acc.correct + G.acc.incorrect;
  $('#hudWpm').textContent = Math.round(wpm);
  $('#hudAcc').textContent = tot ? Math.round(G.acc.correct / tot * 100) : 100;
  $('#hudLap').textContent = G.story ? '—' : `${Math.min(LAPS, Math.floor(G.pos / G.N))}/${LAPS}`;
  if (ts - G.lastPos > 90) { G.lastPos = ts; socket.emit('pos', { prog: myFrac(), wpm: Math.round(wpm) }); }

  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawProgressBar(); drawStrip(); drawScene();
}
function currentWpm() {
  if (!G.intervals.length) return 0;
  const avg = G.intervals.reduce((a,b)=>a+b,0) / G.intervals.length;
  return avg > 0 ? (1000/avg) * 12 : 0;   // letters/sec → wpm (×60/5)
}
function myFrac() { return G.story ? (G.pos / Math.max(1, G.N)) : (G.pos / (G.N * LAPS)); }
function ghostFrac() {
  const sp = G.ghost.splits; if (!sp || !sp.length) return 0;
  const el = (performance.now() - G.ghostStart) % (G.ghost.lapMs || 1);
  let seg = 0; while (seg < sp.length && sp[seg] <= el) seg++;
  return Math.min(1, seg / sp.length);
}

function drawProgressBar() {
  const x0 = 60, x1 = 860, y = 30, w = x1 - x0;
  ctx.fillStyle = '#1a2748'; roundRect(x0, y, w, 12, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,204,51,0.20)'; roundRect(x0, y, w * myFrac(), 12, 6); ctx.fill();
  if (G.ghost && G.ghost.splits && G.ghost.splits.length) barMarker(x0, w, y, ghostFrac(), 'rgba(200,220,255,0.7)');
  for (const p of G.peers.values()) barMarker(x0, w, y, p.prog || 0, p.color || '#8899cc');
  barMarker(x0, w, y, myFrac(), '#ffcc33', true);
  ctx.fillStyle = '#8fa6d8'; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText('start', x0, y + 26);
  ctx.textAlign = 'right'; ctx.fillText(G.story ? 'end of ¶' : '3 laps', x1, y + 26);
}
function barMarker(x0, w, y, frac, color, big) {
  const x = x0 + Math.max(0, Math.min(1, frac)) * w;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y-3); ctx.lineTo(x-6, y-13); ctx.lineTo(x+6, y-13); ctx.closePath(); ctx.fill();
  if (big) { ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🚂', x, y-18); }
}

function drawStrip() {
  const cy = 116;
  // rail + moving sleepers (scroll left with the train)
  ctx.strokeStyle = '#33406b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, cy+34); ctx.lineTo(canvas.width, cy+34); ctx.stroke();
  ctx.strokeStyle = '#46568c'; ctx.lineWidth = 3;
  const off = (G.trainPos * STEP) % 44;
  for (let x = -off; x < canvas.width; x += 44) { ctx.beginPath(); ctx.moveTo(x, cy+28); ctx.lineTo(x, cy+40); ctx.stroke(); }
  // approaching letters
  const first = Math.floor(G.trainPos) - 1;
  for (let g = first; g < first + 16; g++) {
    if (g < G.pos) continue;                     // already resolved
    const ch = windowChar(g); if (ch == null) continue;
    const x = XLOCO + ((g + LEAD) - G.trainPos) * STEP;
    if (x < XLOCO - 30 || x > canvas.width + 44) continue;
    const isT = (g === G.pos);
    const danger = isT && ((g + LEAD) - G.trainPos) < 1.4;
    const tileW = 44;
    ctx.fillStyle = danger ? '#e2455a' : (isT ? '#ffcc33' : '#12203f');
    roundRect(x - tileW/2, cy - 24, tileW, 48, 8); ctx.fill();
    ctx.strokeStyle = isT ? '#fff2b0' : '#3a4a78'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = (isT && !danger) ? '#1a1200' : '#eef3ff'; ctx.font = (isT ? 'bold 26px' : '20px') + ' system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch === ' ' ? '␣' : ch, x, cy);
  }
  // collision point = the locomotive on the track
  ctx.strokeStyle = 'rgba(226,69,90,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(XLOCO, cy-30); ctx.lineTo(XLOCO, cy+30); ctx.stroke();
  ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🚂', XLOCO - 4, cy);
  ctx.fillStyle = '#8fa6d8'; ctx.font = '12px system-ui'; ctx.fillText('type before it reaches the train →', XLOCO + 320, cy - 42);
}

function drawScene() {
  const groundY = 400;
  ctx.fillStyle = '#0e1630'; ctx.fillRect(0, 240, canvas.width, canvas.height-240);
  ctx.fillStyle = '#182247'; ctx.fillRect(0, groundY, canvas.width, canvas.height-groundY);
  ctx.strokeStyle = '#3a4a78'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, groundY+18); ctx.lineTo(canvas.width, groundY+18); ctx.stroke();
  ctx.strokeStyle = '#4a5a90'; ctx.lineWidth = 4;
  const off = (G.trainPos * STEP) % 44;
  for (let x = -off; x < canvas.width; x += 44) { ctx.beginPath(); ctx.moveTo(x, groundY+10); ctx.lineTo(x, groundY+26); ctx.stroke(); }
  ctx.save();
  for (const s of G.steam) { s.life -= 0.02; s.y -= 0.7 + G.rateLPS*0.5; s.x -= 0.8; s.r += 0.4;
    ctx.globalAlpha = Math.max(0, s.life)*0.7; ctx.fillStyle = '#dfe7ff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); }
  G.steam = G.steam.filter(s => s.life > 0); ctx.restore();
  drawLocomotive(300, groundY, G.wheel);
  if (performance.now() - wrongFlash < 200) { ctx.fillStyle = 'rgba(255,60,80,0.15)'; ctx.fillRect(0,240,canvas.width,canvas.height-240); }
  ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 64px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(curChar() === ' ' ? '␣' : (curChar()||''), 690, 340);
}
function spawnSteam(){ G && G.steam.push({ x: 305, y: 350, r: 4, life: 1 }); }

// Code-drawn steam locomotive (profile, facing right). Isolated for raster swap.
function drawLocomotive(x, baseY, wheelPhase) {
  ctx.save(); ctx.translate(x, baseY);
  ctx.fillStyle = '#2b6cb0'; roundRect(-90, -60, 120, 46, 8); ctx.fill();
  ctx.fillStyle = '#22537f'; roundRect(-30, -46, 96, 34, 16); ctx.fill();
  ctx.beginPath(); ctx.arc(66, -29, 17, -Math.PI/2, Math.PI/2); ctx.fill();
  ctx.fillStyle = '#12324d'; ctx.fillRect(58, -46, 8, 34);
  ctx.fillStyle = '#1c3d5c'; ctx.fillRect(30, -74, 16, 30); ctx.fillRect(26, -80, 24, 8);
  ctx.fillStyle = '#0e1c2c'; ctx.fillRect(-78, -50, 26, 22);
  ctx.fillStyle = '#173a57'; ctx.fillRect(-96, -64, 44, 8);
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(6, -48, 8, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#0f2438'; ctx.fillRect(-92, -14, 168, 8);
  ctx.fillStyle = '#0f2438'; ctx.beginPath(); ctx.moveTo(76,-6); ctx.lineTo(96,10); ctx.lineTo(76,10); ctx.closePath(); ctx.fill();
  drawWheel(-64, 10, 16, wheelPhase); drawWheel(-20, 10, 22, wheelPhase); drawWheel(34, 10, 22, wheelPhase);
  ctx.restore();
}
function drawWheel(x, y, r, phase) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(phase);
  ctx.fillStyle = '#0b1a29'; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#5a7fb0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#3a5680'; ctx.lineWidth = 2;
  for (let i=0;i<6;i++){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(i*Math.PI/3)*r, Math.sin(i*Math.PI/3)*r); ctx.stroke(); }
  ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill(); ctx.restore();
}
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

requestAnimationFrame(frame);

if (token) {
  fetch(API('/me'), { headers:{ Authorization:'Bearer '+token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(me => finishAuth(token, me.username))
    .catch(() => { localStorage.removeItem('tt_token'); });
}
})();
