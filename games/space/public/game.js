'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/space/api' + p;
let token = localStorage.getItem('sp_token') || '', socket = null, audio = null;
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
let ships = [], score = 0, streak = 0, lives = 3, spawnAt = 0, playing = false, flash = 0, nextId = 1;

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('sp_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/space/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('sp_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent='👤 '+d.username; $('#team').textContent=d.teamScore||0; playing=true; });
  socket.on('teamScore', d => $('#team').textContent = d.score);
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function nearest() { let n = null; for (const s of ships) if (!n || s.y > n.y) n = s; return n; }   // lowest ship
window.addEventListener('keydown', e => {
  if (!playing || e.key.length !== 1) return;
  const k = e.key.toLowerCase(); if (!LETTERS.includes(k)) return;
  e.preventDefault();
  const tgt = nearest(); if (!tgt) return;
  if (k === tgt.letter) { tgt.boom = 1; boom(); score++; streak++; lives = lives; socket.emit('hit', { correct: true }); }
  else { streak = 0; flash = performance.now(); socket.emit('hit', { correct: false }); }
  $('#score').textContent = score; $('#streak').textContent = streak;
});
function frame(ts){
  requestAnimationFrame(frame);
  ctx.fillStyle='#03030c'; ctx.fillRect(0,0,W,H);
  for(let i=0;i<60;i++){ const x=(i*137)%W, y=(i*89+ts*0.03)%H; ctx.fillStyle='rgba(255,255,255,.25)'; ctx.fillRect(x,y,2,2); }
  if (playing && ts>spawnAt && ships.length<8){ spawnAt = ts + Math.max(700, 1500 - streak*20); ships.push({ id:nextId++, letter: LETTERS[Math.floor(Math.random()*26)], x: 40+Math.random()*(W-80), y:-20, v: 0.6+Math.random()*0.5, boom:0 }); }
  const tgt = nearest();
  for (const s of ships){ if (playing && !s.boom) s.y += s.v; }
  ships = ships.filter(s => {
    if (s.boom>0){ ctx.fillStyle='#ffcf3f'; ctx.font='40px system-ui'; ctx.textAlign='center'; ctx.fillText('💥',s.x,s.y); s.boom+=0.1; return s.boom<1.6; }
    if (s.y>H-16){ lives--; $('#lives').textContent=Math.max(0,lives); flash=performance.now(); if(lives<=0){ playing=false; } return false; }
    drawShip(s, s===tgt); return true;
  });
  if (!playing && lives<=0){ ctx.fillStyle='#fff'; ctx.font='bold 34px system-ui'; ctx.textAlign='center'; ctx.fillText('Game over — tap to play again', W/2, H/2); }
  if (performance.now()-flash<200){ ctx.fillStyle='rgba(255,60,80,.15)'; ctx.fillRect(0,0,W,H); }
}
canvas.addEventListener('pointerdown', ()=>{ if(!playing && lives<=0){ ships=[]; score=0;streak=0;lives=3;$('#lives').textContent=3;$('#score').textContent=0;$('#streak').textContent=0; playing=true; } });
function drawShip(s, isTarget){
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = isTarget ? '#7be06a' : '#8a8a96';
  ctx.fillRect(-16,-10,32,20); ctx.fillRect(-8,-16,16,8); ctx.fillRect(-22,-2,6,10); ctx.fillRect(16,-2,6,10);
  if (isTarget){ ctx.strokeStyle='#7be06a'; ctx.lineWidth=2; ctx.strokeRect(-20,-18,40,32); }
  ctx.fillStyle='#04040f'; ctx.font='bold 18px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(s.letter.toUpperCase(), 0, 0);
  ctx.restore();
}
requestAnimationFrame(frame);
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function boom(){ if(!audio)return; const t=audio.currentTime,len=0.35,buf=audio.createBuffer(1,audio.sampleRate*len,audio.sampleRate),d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length); const s=audio.createBufferSource();s.buffer=buf; const f=audio.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(1100,t); const g=audio.createGain();g.gain.setValueAtTime(0.5,t);g.gain.exponentialRampToValueAtTime(0.001,t+len); s.connect(f);f.connect(g);g.connect(audio.destination);s.start(t); }
if (token) fetch('/space/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('sp_token'));
})();
