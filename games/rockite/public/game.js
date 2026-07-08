'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/rockite/api' + p;
let token = localStorage.getItem('rk_token') || '', socket = null, audio = null;
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
let target = null, tanks = [], phase = 'idle', score = 0, streak = 0, flash = 0;

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  cheer(m){ socket.emit('cheer', { msg:m }); },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('rk_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/rockite/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('rk_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent='👤 '+d.username;
    $('#cheers').innerHTML = (d.cheers||[]).map(c=>`<button onclick="G.cheer('${c.replace(/'/g,"\\'")}')">${c}</button>`).join('');
    socket.emit('newRound'); });
  socket.on('peerCheer', ({ username, msg }) => { const el=$('#peerCheer'); el.textContent = `${username}: ${msg}`; setTimeout(()=>{ if(el.textContent.startsWith(username)) el.textContent=''; }, 2500); });
  socket.on('round', r => startRound(r));
  socket.on('result', ({ correct }) => endRound(correct));
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function startRound(r){
  target = r.target; phase='play';
  $('#call').textContent = `🔊 Shoot ${target}!`; say(`Shoot ${target}`);
  const lanes = r.tanks.length, gap = (H-40)/lanes;
  tanks = r.tanks.map((val,i)=>({ val, x:-60-i*120, y:30+i*gap+gap/2, vx:0.9, r:30, boom:0 }));
}
function endRound(correct){
  phase='result';
  if (correct){ boom(); score++; streak++; }
  else { flash=performance.now(); streak=0; }
  $('#score').textContent=score; $('#streak').textContent=streak;
  setTimeout(()=>socket.emit('newRound'), correct?700:1000);
}
canvas.addEventListener('pointerdown', e=>{
  if (phase!=='play') return;
  const rect=canvas.getBoundingClientRect(); const x=(e.clientX-rect.left)*(W/rect.width), y=(e.clientY-rect.top)*(H/rect.height);
  const hit = tanks.find(t=>Math.abs(t.x-x)<t.r+10 && Math.abs(t.y-y)<t.r+10);
  if (hit){ phase='wait'; hit.boom=1; boom(); socket.emit('answer',{choice:hit.val}); }
});
function frame(){
  requestAnimationFrame(frame);
  ctx.fillStyle='#3a5a2a'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(0,0,0,.08)'; for(let x=0;x<W;x+=30)ctx.fillRect(x,0,15,H);
  for(const t of tanks){
    if (phase==='play'){ t.x+=t.vx; if(t.x>W+60)t.x=-60; }
    if (t.boom>0){ ctx.fillStyle='#ffcf3f'; ctx.font='42px system-ui'; ctx.textAlign='center'; ctx.fillText('💥',t.x,t.y); continue; }
    ctx.fillStyle='#2f6b1f'; ctx.fillRect(t.x-t.r,t.y-12,t.r*2,22);            // body (blocky green)
    ctx.fillStyle='#245217'; ctx.fillRect(t.x-4,t.y-24,26,10);                 // turret
    ctx.fillStyle='#245217'; ctx.fillRect(t.x+18,t.y-20,20,5);                 // barrel
    ctx.fillStyle='#1a3a10'; for(let w=-t.r;w<t.r;w+=10)ctx.fillRect(t.x+w,t.y+10,7,7); // treads
    ctx.fillStyle='#fff'; ctx.font='bold 20px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t.val,t.x+8,t.y-1);
  }
  if (performance.now()-flash<250){ ctx.fillStyle='rgba(255,60,80,.15)'; ctx.fillRect(0,0,W,H); }
}
requestAnimationFrame(frame);
function say(txt){ try{ const u=new SpeechSynthesisUtterance(txt); u.rate=0.95; speechSynthesis.cancel(); speechSynthesis.speak(u); }catch(e){} }
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function boom(){ if(!audio)return; const t=audio.currentTime,len=0.32,buf=audio.createBuffer(1,audio.sampleRate*len,audio.sampleRate),d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length); const s=audio.createBufferSource();s.buffer=buf; const f=audio.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(900,t); const g=audio.createGain();g.gain.setValueAtTime(0.45,t);g.gain.exponentialRampToValueAtTime(0.001,t+len); s.connect(f);f.connect(g);g.connect(audio.destination);s.start(t); }
if (token) fetch('/rockite/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('rk_token'));
})();
