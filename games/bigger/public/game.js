'use strict';
(() => {
const $ = s => document.querySelector(s);
const API = p => '/bigger/api' + p;
let token = localStorage.getItem('bg_token') || '', socket = null, audio = null;
let round = null, phase = 'idle', score = 0, streak = 0;

async function post(p, b) { const r = await fetch(API(p), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }); const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error||'Error'); return j; }
const G = {
  async login()    { ensureAudio(); try { const j = await post('/login',    { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  async register() { ensureAudio(); try { const j = await post('/register', { username:$('#u').value.trim(), password:$('#p').value }); done(j.token); } catch(e){ $('#loginErr').textContent = e.message; } },
  pick(side) {
    if (phase !== 'play') return;
    phase = 'wait';
    socket.emit('answer', { choice: side === 'left' ? round.left : round.right });
  },
};
window.G = G;
function done(t) { token = t; localStorage.setItem('bg_token', t); $('#loginOv').style.display='none'; connect(); }
function connect() {
  socket = io({ path:'/bigger/socket.io', auth:{ token } });
  socket.on('authError', () => { localStorage.removeItem('bg_token'); location.reload(); });
  socket.on('joined', d => { $('#who').textContent = '👤 ' + d.username; socket.emit('newRound'); });
  socket.on('round', r => { round = r; phase = 'play'; $('#left').textContent = r.left; $('#right').textContent = r.right; $('#fb').textContent = 'Which is BIGGER?'; });
  socket.on('result', ({ correct }) => {
    if (correct) { score++; streak++; ding(); $('#gator').classList.add('chomp'); setTimeout(()=>$('#gator').classList.remove('chomp'),400); $('#fb').textContent = '😋 Yum! Chomp!'; }
    else { streak = 0; const g = $('#play'); g.classList.add('wrong'); setTimeout(()=>g.classList.remove('wrong'),400); $('#fb').textContent = '🙂 The other one was bigger — try again!'; }
    $('#score').textContent = score; $('#streak').textContent = streak;
    setTimeout(() => socket.emit('newRound'), correct ? 600 : 1000);
  });
  socket.on('kicked', ({ reason }) => { alert(reason||'Removed'); location.href='/'; });
  socket.emit('join');
}
function ensureAudio(){ if(!audio){try{audio=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}} if(audio&&audio.state==='suspended')audio.resume(); }
function ding(){ if(!audio)return; const t=audio.currentTime,o=audio.createOscillator(),g=audio.createGain(); o.type='sine'; o.frequency.setValueAtTime(880,t); o.frequency.setValueAtTime(1320,t+0.08); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.3,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.28); o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t+0.3); }
if (token) fetch('/bigger/api/me',{headers:{Authorization:'Bearer '+token}}).then(r=>r.ok?r.json():Promise.reject()).then(()=>done(token)).catch(()=>localStorage.removeItem('bg_token'));
})();
