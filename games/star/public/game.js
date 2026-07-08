'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/star/api' + p;
let token = localStorage.getItem('st_token') || '', socket = null, audio = null, username = '';
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
let ch = null, phase = 'idle', traceProg = 0, fbUntil = 0, fbText = '';
const bg = Array.from({ length: 140 }, () => ({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.3+0.2 }));

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('st_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/star/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('st_token'); location.reload(); });
  socket.on('joined', d => { username=d.username; $('#who').textContent='🧭 '+d.username; });
  socket.on('leaderboard', rows => { $('#rows').innerHTML = rows.map(r=>`<div class="row ${r.username===username?'me':''}"><span>${esc(r.username)}</span><b>${r.score}</b></div>`).join(''); });
  socket.on('challenge', c => startChallenge(c));
  socket.on('result', ({ correct }) => { chime(correct); fbText = correct?'⭐ Aye, Captain!':'🧭 Not quite — try the next one'; fbUntil=performance.now()+900; $('#options').innerHTML=''; setTimeout(()=>socket.emit('next'), 900); });
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
// map normalized star coords (0..1) to a centered box on the canvas
function P(s){ const pad=50; return { x: pad + s.x*(W-2*pad), y: pad + s.y*(H-2*pad) }; }
function startChallenge(c){
  ch = c; phase = c.type; traceProg = 0;
  if (c.type === 'name') { $('#task').innerHTML = `Which star is the <b>glowing</b> one?`; $('#options').innerHTML = c.options.map(o=>`<button onclick="pickName('${o.replace(/'/g,"\\'")}')">${o}</button>`).join(''); }
  else { $('#task').innerHTML = `Trace <b>${esc(c.c.name)}</b> — tap its stars in order. <span style="opacity:.7">${esc(c.c.hint)}</span>`; $('#options').innerHTML=''; }
}
window.pickName = name => { if (phase!=='name') return; phase='wait'; socket.emit('answer', { name }); };
canvas.addEventListener('pointerdown', e => {
  if (phase !== 'trace' || !ch) return;
  const rect=canvas.getBoundingClientRect(); const x=(e.clientX-rect.left)*(W/rect.width), y=(e.clientY-rect.top)*(H/rect.height);
  const line = ch.c.line, want = line[traceProg];
  const p = P(ch.c.stars[want]);
  if (Math.hypot(p.x-x, p.y-y) < 26) { traceProg++; twinkle(); if (traceProg >= line.length) { phase='wait'; socket.emit('traced'); } }
  else { fbText='🧭 Follow the shape in order'; fbUntil=performance.now()+700; }
});
function frame(){
  requestAnimationFrame(frame);
  ctx.fillStyle='#02030a'; ctx.fillRect(0,0,W,H);
  for (const s of bg){ ctx.globalAlpha=0.4+Math.random()*0.3; ctx.fillStyle='#cdd8ff'; ctx.fillRect(s.x,s.y,s.r,s.r); } ctx.globalAlpha=1;
  if (ch){
    const stars = ch.type==='name' ? ch.c.stars : ch.c.stars;
    const line = ch.type==='name' ? ch.c.line : ch.c.line;
    // faint full shape for 'name'; progressive for 'trace'
    ctx.strokeStyle='rgba(120,150,255,.28)'; ctx.lineWidth=2; ctx.beginPath();
    const drawTo = ch.type==='name' ? line.length : traceProg+1;
    for (let i=0;i<Math.min(drawTo,line.length);i++){ const p=P(stars[line[i]]); i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y); }
    ctx.stroke();
    stars.forEach((s,i)=>{ const p=P(s); const size=Math.max(2.5, 6.5-s.mag);
      const hot = ch.type==='name' && i===ch.starIdx;
      const nextTrace = ch.type==='trace' && line[traceProg]===i;
      ctx.beginPath(); ctx.arc(p.x,p.y, size + (hot?4:0), 0, Math.PI*2);
      ctx.fillStyle = hot ? '#ffe08a' : '#eef3ff'; ctx.fill();
      if (hot||nextTrace){ ctx.strokeStyle= hot?'#ffd23f':'#7be06a'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y, size+7+2*Math.sin(performance.now()/200),0,Math.PI*2); ctx.stroke(); }
    });
  }
  if (performance.now()<fbUntil){ ctx.fillStyle='#ffe08a'; ctx.font='bold 20px system-ui'; ctx.textAlign='center'; ctx.fillText(fbText, W/2, H-16); }
}
requestAnimationFrame(frame);
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function twinkle(){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(1400,t); g.gain.setValueAtTime(0.12,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.15); o.connect(g);g.connect(audio.destination); o.start(t);o.stop(t+0.16); }
function chime(up){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(up?660:400,t); o.frequency.setValueAtTime(up?990:330,t+0.1); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.35); o.connect(g);g.connect(audio.destination); o.start(t);o.stop(t+0.36); }
if (token) fetch('/star/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(me=>done(token)).catch(()=>localStorage.removeItem('st_token'));
})();
