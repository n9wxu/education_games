'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/art/api' + p;
let token = localStorage.getItem('art_token') || '', socket = null, audio = null;
const pad = $('#pad'), ctx = pad.getContext('2d'); const W = pad.width, H = pad.height;
let color = 'hsl(320,80%,55%)', pen = 8, drawing = false, last = null;
let endsAt = 0, submitted = false, phase = 'draw';

// swatches
['#000000','#ffffff','#e0245e','#ff8a3d','#ffd23f','#7be06a','#4ec3ff','#7a2aa0','#8b5a2b'].forEach(c => {
  const b = document.createElement('div'); b.className = 'sw'; b.style.background = c; b.onclick = () => { color = c; $('#hue').value = 0; }; $('#swatches').appendChild(b);
});
$('#hue').addEventListener('input', e => { color = `hsl(${e.target.value},80%,55%)`; });
$('#pen').addEventListener('input', e => { pen = +e.target.value; });

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const A = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  clear() { ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); },
};
window.A = A;
function done(t){ token=t; localStorage.setItem('art_token',t); $('#loginOv').style.display='none'; A.clear(); connect(); }
function connect(){
  socket = io({ path:'/art/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('art_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent='👤 '+d.username; newPrompt(d.prompt); (d.gallery||[]).forEach(addArt); });
  socket.on('prompt', p => newPrompt(p));
  socket.on('artwork', a => addArt(a));
  socket.on('sticker', ({ artId, kind, count }) => { const el = document.querySelector(`#art${artId} .${kind}c`); if (el) el.textContent = count; });
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function newPrompt(p){
  $('#ptext').textContent = p.text; endsAt = p.endsAt; submitted = false; phase = 'draw';
  $('#draw').style.display = 'flex'; $('#gallery').style.display = 'none'; $('#cards').innerHTML = ''; A.clear();
}
// drawing
pad.addEventListener('pointerdown', e => { if (phase!=='draw') return; ensureAudio(); drawing = true; last = pt(e); dot(last); });
pad.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.strokeStyle=color; ctx.lineWidth=pen; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last = p; });
window.addEventListener('pointerup', () => drawing = false);
function pt(e){ const r=pad.getBoundingClientRect(); return { x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(H/r.height) }; }
function dot(p){ ctx.fillStyle=color; ctx.beginPath(); ctx.arc(p.x,p.y,pen/2,0,Math.PI*2); ctx.fill(); }
// timer + submit
function tick(){
  requestAnimationFrame(tick);
  if (!endsAt) return;
  const left = Math.max(0, endsAt - Date.now()), frac = left / 75000;
  $('#timefill').style.width = Math.min(100, frac*100) + '%';
  if (left <= 0 && !submitted && phase==='draw') submit();
}
function submit(){
  submitted = true; phase = 'gallery'; squeak();
  const t = document.createElement('canvas'); t.width = 260; t.height = Math.round(260*H/W);
  t.getContext('2d').drawImage(pad, 0, 0, t.width, t.height);
  socket.emit('submit', { img: t.toDataURL('image/jpeg', 0.6) });
  $('#draw').style.display = 'none'; $('#gallery').style.display = 'flex';
}
function addArt(a){
  if (document.getElementById('art'+a.id)) return;
  const d = document.createElement('div'); d.className = 'art'; d.id = 'art'+a.id;
  d.innerHTML = `<img src="${a.img}" alt="art"><div style="font-size:.85rem;margin-top:4px">${esc(a.username)}</div>
    <div class="st"><button onclick="giveSticker(${a.id},'star')">⭐ <span class="starc">${a.stickers?a.stickers.star:0}</span></button>
    <button onclick="giveSticker(${a.id},'rainbow')">🌈 <span class="rainbowc">${a.stickers?a.stickers.rainbow:0}</span></button></div>`;
  $('#cards').appendChild(d);
}
window.giveSticker = (id, kind) => { socket.emit('sticker', { artId:id, kind }); ding(); };
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
requestAnimationFrame(tick);
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function squeak(){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(300,t); o.frequency.exponentialRampToValueAtTime(1400,t+0.15); o.frequency.exponentialRampToValueAtTime(500,t+0.3); g.gain.setValueAtTime(0.25,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.35); o.connect(g);g.connect(audio.destination); o.start(t);o.stop(t+0.36); }
function ding(){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='triangle'; o.frequency.setValueAtTime(1046,t); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.2); o.connect(g);g.connect(audio.destination); o.start(t);o.stop(t+0.22); }
if (token) fetch('/art/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('art_token'));
})();
