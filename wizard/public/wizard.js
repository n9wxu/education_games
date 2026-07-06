'use strict';
/* Game Wizard — kid-facing chat client. Streams the AI helper's replies (NDJSON)
   and keeps the whole conversation so each turn has context. */
(() => {
const $ = s => document.querySelector(s);
const API = p => '/wizard/api' + p;
let token = localStorage.getItem('gw_token') || '';
let username = '';
let history = [];        // [{role, content}]
let busy = false;

async function post(path, body, auth) {
  const r = await fetch(API(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}

const W = {
  async login()    { try { const j = await post('/login',    { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
  async register() { try { const j = await post('/register', { username: $('#u').value.trim(), password: $('#p').value }); done(j.token, j.username); } catch (e) { $('#loginErr').textContent = e.message; } },
  send() { sendText($('#text').value); },
};
window.W = W;

function done(t, name) {
  token = t; username = name; localStorage.setItem('gw_token', t);
  $('#loginOv').style.display = 'none';
  $('#who').textContent = '👤 ' + name;
  boot();
}

async function boot() {
  const st = await (await fetch(API('/status'))).json();
  if (!st.aiEnabled) $('#aiWarn').style.display = '';
  // Kick off the conversation with a friendly opener from the helper.
  history = [];
  await streamTurn(true);
}

function bubble(cls, who) {
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  if (who) { const w = document.createElement('span'); w.className = 'who'; w.textContent = who; el.appendChild(w); }
  const body = document.createElement('span'); el.appendChild(body);
  $('#chat').appendChild(el);
  scroll();
  return { setText: t => { body.textContent = t; scroll(); }, el };
}
function scroll() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }
function setChips(list) {
  const box = $('#chips'); box.innerHTML = '';
  (list || []).forEach(txt => {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = txt;
    b.onclick = () => sendText(txt);
    box.appendChild(b);
  });
}

async function sendText(text) {
  text = (text || '').trim();
  if (!text || busy) return;
  $('#text').value = '';
  setChips([]);
  bubble('me', username).setText(text);
  history.push({ role: 'user', content: text });
  await streamTurn(false);
}

async function streamTurn(isOpener) {
  busy = true; $('#sendBtn').disabled = true;
  // If this is the opener, prime with a hidden greeting so the helper starts.
  const messages = isOpener ? [{ role: 'user', content: "Hi! I'd like to make a game. Please start by saying hello and asking me about school subjects." }] : history.slice();
  const out = bubble('bot', '🧙 Helper'); out.setText('…'); out.el.classList.add('typing');
  let acc = '';
  try {
    const resp = await fetch(API('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ messages }),
    });
    if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || 'Error'); }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: d } = await reader.read();
      if (d) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'text') { acc += ev.text; out.el.classList.remove('typing'); out.setText(acc); }
        else if (ev.type === 'saved') { const s = document.createElement('div'); s.className = 'saved'; s.textContent = `🎉 Your game “${ev.title}” is saved! A grown-up will look at it.`; $('#chat').appendChild(s); scroll(); }
        else if (ev.type === 'error') { out.el.classList.remove('typing'); out.setText(acc || ('⚠️ ' + (ev.message || 'Something went wrong.'))); }
      }
    }
  } catch (e) {
    out.el.classList.remove('typing');
    out.setText(acc || ('⚠️ ' + e.message));
  }
  if (acc) history.push({ role: 'assistant', content: acc });
  busy = false; $('#sendBtn').disabled = false; $('#text').focus();
}

// auto-login
if (token) {
  fetch(API('/me'), { headers: { Authorization: 'Bearer ' + token } })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(me => done(token, me.username))
    .catch(() => localStorage.removeItem('gw_token'));
}
})();
