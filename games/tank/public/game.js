'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/tank/api' + p;
let token = localStorage.getItem('tk_token') || '', socket = null, audio = null;
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
let correctVal = null, tanks = [], phase = 'idle', score = 0, streak = 0, flash = 0;

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('tk_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/tank/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('tk_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent='👤 '+d.username; $('#team').textContent=d.teamScore||0; socket.emit('newRound'); });
  socket.on('teamScore', d => $('#team').textContent = d.score);
  socket.on('round', r => startRound(r));
  socket.on('result', ({ correct }) => endRound(correct));
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function startRound(r){
  $('#prob').textContent = r.problem + ' = ?'; phase='play';
  const lanes = r.tanks.length; const gap = (H-60)/lanes;
  tanks = r.tanks.map((val,i) => ({ val, x: -60 - i*90, y: 40 + i*gap + gap/2, vx: 1.6, r:32, dead:false, boom:0 }));
}
function endRound(correct){
  phase='result';
  if (correct){ boom(); score++; streak++; }
  else { flash=performance.now(); streak=0; }
  $('#score').textContent=score; $('#streak').textContent=streak;
  setTimeout(()=>socket.emit('newRound'), correct?650:1000);
}
canvas.addEventListener('pointerdown', e => {
  if (phase!=='play') return;
  const rect=canvas.getBoundingClientRect(); const x=(e.clientX-rect.left)*(W/rect.width), y=(e.clientY-rect.top)*(H/rect.height);
  const hit = tanks.find(t=>!t.dead && Math.abs(t.x-x)<t.r+8 && Math.abs(t.y-y)<t.r+8);
  if (hit){ phase='wait'; hit.boom=1; boom(); socket.emit('answer',{choice:hit.val}); }
});
function frame(){
  requestAnimationFrame(frame);
  ctx.fillStyle='#5a7a3a'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,.08)'; for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for (const t of tanks){
    if (phase==='play'){ t.x+=t.vx; if(t.x>W+60){ t.x=-60; } }
    if (t.boom>0){ ctx.fillStyle='#ffcf3f'; ctx.font='42px system-ui'; ctx.textAlign='center'; ctx.fillText('💥',t.x,t.y); continue; }
    ctx.fillStyle='#3f5a24'; ctx.fillRect(t.x-t.r, t.y-14, t.r*2, 24);
    ctx.fillStyle='#2e4519'; ctx.fillRect(t.x-6,t.y-26,30,10);
    ctx.fillStyle='#1e2f10'; for(let w=-t.r;w<t.r;w+=12) ctx.fillRect(t.x+w, t.y+10, 8, 8);
    ctx.fillStyle='#fff'; ctx.font='bold 20px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t.val, t.x+8, t.y-2);
  }
  if (performance.now()-flash<250){ ctx.fillStyle='rgba(255,60,80,.15)'; ctx.fillRect(0,0,W,H); }
}
requestAnimationFrame(frame);
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function boom(){ if(!audio)return; const t=audio.currentTime,len=0.3,buf=audio.createBuffer(1,audio.sampleRate*len,audio.sampleRate),d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length); const s=audio.createBufferSource(); s.buffer=buf; const f=audio.createBiquadFilter(); f.type='lowpass'; f.frequency.setValueAtTime(900,t); const g=audio.createGain(); g.gain.setValueAtTime(0.4,t); g.gain.exponentialRampToValueAtTime(0.001,t+len); s.connect(f);f.connect(g);g.connect(audio.destination); s.start(t);
  const o=audio.createOscillator(),g2=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(1600,t); o.frequency.setValueAtTime(2100,t+0.05); g2.gain.setValueAtTime(0.12,t); g2.gain.exponentialRampToValueAtTime(0.001,t+0.2); o.connect(g2);g2.connect(audio.destination); o.start(t);o.stop(t+0.22); }
if (token) fetch('/tank/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('tk_token'));
})();
