'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/citynum/api' + p;
let token = localStorage.getItem('cn_token') || '', socket = null, audio = null;
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
let target = null, enemies = [], phase = 'idle', score = 0, streak = 0, tEnd = 0, clicked = null, flash = 0;

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('cn_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/citynum/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('cn_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent='👤 '+d.username; socket.emit('newRound'); });
  socket.on('round', r => startRound(r));
  socket.on('result', ({ correct, answer }) => endRound(correct, answer));
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function startRound(r){
  target = r.target; $('#tnum').textContent = target; phase='play'; clicked=null;
  enemies = r.enemies.map(num => ({ num, x: 70+Math.random()*(W-140), y: 70+Math.random()*(H-140), vx:(Math.random()*2-1)*1.1, vy:(Math.random()*2-1)*1.1, r:34, dead:false, pop:0 }));
  tEnd = performance.now() + 6500;
}
function endRound(correct, answer){
  phase='result';
  if (correct){ pew(); const e = enemies.find(e=>e.num===target); if(e){ e.pop=1; poof(); } score++; streak++; }
  else { flash = performance.now(); streak=0; }
  $('#score').textContent=score; $('#streak').textContent=streak;
  setTimeout(()=>socket.emit('newRound'), correct?650:1100);
}
canvas.addEventListener('pointerdown', e => {
  if (phase!=='play') return;
  const rect = canvas.getBoundingClientRect(); const x=(e.clientX-rect.left)*(W/rect.width), y=(e.clientY-rect.top)*(H/rect.height);
  const hit = enemies.find(en => !en.dead && Math.hypot(en.x-x, en.y-y) < en.r+4);
  if (hit){ phase='wait'; clicked=hit; pew(); socket.emit('answer', { choice: hit.num }); }
});
function frame(){
  requestAnimationFrame(frame);
  ctx.fillStyle='#182a4a'; ctx.fillRect(0,0,W,H);
  // simple city skyline
  ctx.fillStyle='#0f1d38'; for(let i=0;i<10;i++){ const bw=W/10; ctx.fillRect(i*bw+4, H-60-((i*53)%80), bw-8, 200); }
  for (const en of enemies){
    if (phase==='play'){ en.x+=en.vx; en.y+=en.vy; if(en.x<en.r||en.x>W-en.r)en.vx*=-1; if(en.y<en.r||en.y>H-en.r)en.vy*=-1; }
    if (en.pop>0){ en.pop+=0.08; ctx.globalAlpha=Math.max(0,1-en.pop+1); ctx.fillStyle='#ffd23f'; ctx.font='40px system-ui'; ctx.textAlign='center'; ctx.fillText('💥', en.x, en.y); ctx.globalAlpha=1; continue; }
    const isAns = phase==='result' && en.num===target;
    ctx.fillStyle = isAns ? '#7be06a' : '#c0392b'; ctx.beginPath(); ctx.arc(en.x,en.y,en.r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 22px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('👾',en.x,en.y-10);
    ctx.fillText(en.num, en.x, en.y+13);
  }
  // zap timer bar
  if (phase==='play'){ const left=Math.max(0,(tEnd-performance.now())/6500); ctx.fillStyle= left<0.3?'#ff5566':'#ffd23f'; ctx.fillRect(0,H-8,W*left,8);
    if (left<=0){ phase='wait'; socket.emit('answer',{choice:-1}); } }
  if (performance.now()-flash<250){ ctx.fillStyle='rgba(255,60,80,.15)'; ctx.fillRect(0,0,W,H); }
}
requestAnimationFrame(frame);
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function pew(){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='square'; o.frequency.setValueAtTime(900,t); o.frequency.exponentialRampToValueAtTime(200,t+0.12); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.14); o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t+0.15); }
function poof(){ if(!audio)return; const t=audio.currentTime,len=0.25,buf=audio.createBuffer(1,audio.sampleRate*len,audio.sampleRate),d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length); const s=audio.createBufferSource(); s.buffer=buf; const g=audio.createGain(); g.gain.setValueAtTime(0.3,t); g.gain.exponentialRampToValueAtTime(0.001,t+len); s.connect(g); g.connect(audio.destination); s.start(t); }
if (token) fetch('/citynum/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('cn_token'));
})();
