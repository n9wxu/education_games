'use strict';
// Shared authentication router + helpers, mounted under each game's base path
// (e.g. /math/api/login). All games share one accounts table, so a token issued
// by one game authenticates the player in every game (single sign-on).
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('./db');

function tokenFrom(req) {
  return (req.headers.authorization || '').replace('Bearer ', '')
    || (req.query && req.query.token) || '';
}

// Express middleware: attaches req.player (the db row) or 401s.
function requireAuth(req, res, next) {
  const session = db.getSession(tokenFrom(req));
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const player = db.getPlayerById(session.player_id);
  if (!player) return res.status(401).json({ error: 'Not authenticated' });
  req.player = player;
  next();
}

// Resolve a socket.io handshake token → db player row (or null).
function playerFromSocket(socket) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return null;
  const session = db.getSession(token);
  return session ? db.getPlayerById(session.player_id) : null;
}

function router() {
  const r = express.Router();

  r.post('/api/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const clean = String(username).trim().slice(0, 18);
    if (clean.length < 2) return res.status(400).json({ error: 'Username too short' });
    if (db.findPlayer(clean)) return res.status(409).json({ error: 'Username taken' });
    const hash  = await bcrypt.hash(String(password), 8);
    const pid   = db.register(clean, hash);
    const token = db.createSession(pid);
    res.json({ token, username: clean, stats: db.getStats(pid) });
  });

  r.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const player = db.findPlayer(String(username).trim());
    if (!player) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(String(password), player.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = db.createSession(player.id);
    res.json({ token, username: player.username, stats: db.getStats(player.id) });
  });

  r.post('/api/logout', (req, res) => {
    db.deleteSession(tokenFrom(req));
    res.json({ ok: true });
  });

  r.get('/api/me', (req, res) => {
    const session = db.getSession(tokenFrom(req));
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const player = db.getPlayerById(session.player_id);
    if (!player) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ username: player.username, playerId: player.id, stats: db.getStats(player.id) });
  });

  return r;
}

module.exports = { router, requireAuth, playerFromSocket, tokenFrom };
