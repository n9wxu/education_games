'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/star/api' + p;
let token = localStorage.getItem('st_token') || '', socket = null, audio = null, username = '';
const canvas = $('#c'), ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
let ch = null, phase = 'idle', fbUntil = 0, fbText = '', bgStars = [];

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  study(){ if (phase==='tutorial'){ phase='wait'; $('#options').innerHTML=''; socket.emit('next'); } },
};
window.G = G;
function done(t){ token=t; localStorage.setItem('st_token',t); $('#loginOv').style.display='none'; connect(); }
function connect(){
  socket = io({ path:'/star/socket.io', auth:{ token } });
  socket.on('authError', ()=>{ localStorage.removeItem('st_token'); location.reload(); });
  socket.on('joined', d => { username=d.username; $('#who').textContent='🧭 '+d.username; });
  socket.on('leaderboard', rows => { $('#rows').innerHTML = rows.map(r=>`<div class="row ${r.username===username?'me':''}"><span>${esc(r.username)}</span><b>${r.score}</b></div>`).join(''); });
  socket.on('challenge', c => startChallenge(c));
  socket.on('result', ({ correct }) => { chime(correct); fbText = correct?'⭐ Aye, Captain!':'🧭 Keep studying the sky'; fbUntil=performance.now()+1000; $('#options').innerHTML=''; setTimeout(()=>socket.emit('next'), 1000); });
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function seededBg(seed, tier){
  const n = tier===2 ? 230 : tier===1 ? 90 : 25;
  let a = (seed>>>0) || 1; const rng = () => { a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
  const tints = ['#ffffff','#ffffff','#cbdaff','#ffd2a1','#fbf4de'];
  return Array.from({length:n}, () => ({ x: rng()*W, y: rng()*H, r: 0.4+rng()*1.3, c: tints[(rng()*tints.length)|0], a: 0.25+rng()*0.5 }));
}
function P(s){ const pad=54; return { x: pad + s.x*(W-2*pad), y: pad + s.y*(H-2*pad) }; }
function startChallenge(c){
  ch = c; phase = c.type;
  bgStars = c.type==='tutorial' ? seededBg(7,0) : seededBg(c.seed, c.tier);
  if (c.type === 'tutorial'){
    $('#task').innerHTML = `📖 Learn <b>${esc(c.c.name)}</b> — <span style="opacity:.75">${esc(c.c.hint)}</span>`;
    $('#options').innerHTML = `<button onclick="G.study()">I've studied it — quiz me ⭐</button>`;
  } else if (c.type === 'name-star'){
    $('#task').innerHTML = `Which star is the <b>glowing</b> one?` + tierNote(c.tier);
    $('#options').innerHTML = c.options.map(o=>`<button onclick="pick('${esc(o).replace(/'/g,"\\'")}')">${esc(o)}</button>`).join('');
  } else {
    $('#task').innerHTML = `Which constellation is this?` + tierNote(c.tier);
    $('#options').innerHTML = c.options.map(o=>`<button onclick="pick('${esc(o).replace(/'/g,"\\'")}')">${esc(o)}</button>`).join('');
  }
}
function tierNote(t){ return t>=2 ? ' <span style="opacity:.6;font-size:.85rem">(real sky — it blends in!)</span>' : t===1 ? ' <span style="opacity:.6;font-size:.85rem">(faded lines)</span>' : ''; }
window.pick = name => { if (phase==='name-star'||phase==='name-constellation'){ phase='wait'; socket.emit('answer', { name }); } };

// subtle star colour: mix toward white so the tint is gentle, like the real eye sees
function tint(hex, amt){ const n=parseInt(hex.slice(1),16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; const m=v=>Math.round(v+(255-v)*amt); return `rgb(${m(r)},${m(g)},${m(b)})`; }
function drawStar(p, mag, color, glow, subtle){
  const size = Math.max(1.6, 6 - (mag||2));
  const col = tint(color||'#ffffff', subtle);
  ctx.save();
  if (glow){ ctx.shadowColor = col; ctx.shadowBlur = glow; }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}
function frame(){
  requestAnimationFrame(frame);
  ctx.fillStyle='#02030a'; ctx.fillRect(0,0,W,H);
  for (const s of bgStars){ ctx.globalAlpha=s.a; ctx.fillStyle=tint(s.c,0.4); ctx.fillRect(s.x,s.y,s.r,s.r); } ctx.globalAlpha=1;
  if (ch){
    const tier = ch.type==='tutorial' ? 0 : ch.tier;
    const stars = ch.type==='tutorial' ? ch.c.stars : ch.stars;
    const line  = ch.type==='tutorial' ? ch.c.line  : ch.line;
    const lineA = ch.type==='tutorial' ? 0.55 : tier===0 ? 0.45 : tier===1 ? 0.14 : 0.0;
    if (lineA > 0){ ctx.strokeStyle=`rgba(130,160,255,${lineA})`; ctx.lineWidth=2; ctx.beginPath();
      line.forEach((idx,i)=>{ const p=P(stars[idx]); i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y); }); ctx.stroke(); }
    const subtle = tier>=2 ? 0.55 : 0.4;   // a touch more white at the hard tier
    stars.forEach((s,i)=>{ const p=P(s);
      const hot = ch.type==='name-star' && i===ch.starIdx;
      drawStar(p, s.mag, s.color, hot?16:(tier>=2?0:6), subtle);
      if (ch.type==='tutorial'){ ctx.fillStyle='#cdd8ff'; ctx.font='12px system-ui'; ctx.textAlign='center'; ctx.fillText(s.name, p.x, p.y-12); }
      if (hot){ ctx.strokeStyle='#ffd23f'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y, 12+2*Math.sin(performance.now()/200),0,Math.PI*2); ctx.stroke(); }
    });
  }
  if (performance.now()<fbUntil){ ctx.fillStyle='#ffe08a'; ctx.font='bold 20px system-ui'; ctx.textAlign='center'; ctx.fillText(fbText, W/2, H-16); }
}
requestAnimationFrame(frame);
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function chime(up){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(up?660:400,t); o.frequency.setValueAtTime(up?990:330,t+0.1); g.gain.setValueAtTime(0.2,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.35); o.connect(g);g.connect(audio.destination); o.start(t);o.stop(t+0.36); }
if (token) fetch('/star/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(me=>done(token)).catch(()=>localStorage.removeItem('st_token'));
})();
