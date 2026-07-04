'use strict';
// Unified teacher interface, mounted at /teacher.
//   /teacher               → teacher.html
//   /teacher/api/*         → password-gated JSON API spanning all games
// Word data (lists/words/mastery/sessions) lives in one shared DB, so most
// endpoints hit the DB directly; live actions (kick, list-changed) fan out to
// the mounted game instances.
const express = require('express');
const path    = require('path');
const bcrypt  = require('bcryptjs');
const db      = require('../shared/db');

const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teacher';

module.exports = function createTeacher(mounted) {
  const router = express.Router();
  const games  = Object.values(mounted);
  const spelling = ['spelling', 'sniper'].map(k => mounted[k]).filter(Boolean);

  const notifyListChanged = () => spelling.forEach(g => g.broadcast && g.broadcast('listChanged'));
  const kickEverywhere   = (id, reason) => games.forEach(g => g.kickPlayer && g.kickPlayer(id, reason));

  // Self-contained teacher.html under /teacher
  router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'teacher.html')));
  router.use(express.json());

  // ─── Password gate for the API ──────────────────────────────────────────────
  router.use('/api', (req, res, next) => {
    const pw = req.headers['x-teacher-password'] || req.query.pw;
    if (pw !== TEACHER_PASSWORD) return res.status(403).json({ error: 'Forbidden' });
    next();
  });

  router.get('/api/verify', (req, res) => res.json({ ok: true }));

  // ─── Players (combined math + spelling view) ────────────────────────────────
  router.get('/api/players', (req, res) => {
    res.json(db.allPlayers().map(p => ({
      ...p,
      math:  db.getStats(p.id),
      focus: db.getFocusFacts(p.id),
      spellingMastery: db.allMastery(p.id),
    })));
  });

  router.delete('/api/players/:id', (req, res) => {
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Bad id' });
    kickEverywhere(pid, 'Account removed by teacher');
    db.deletePlayer(pid);
    res.json({ ok: true });
  });

  router.post('/api/players/:id/reset-password', async (req, res) => {
    const pid = Number(req.params.id);
    const { newPassword } = req.body || {};
    if (!pid || !newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'Bad request' });
    db.resetPassword(pid, await bcrypt.hash(String(newPassword), 8));
    res.json({ ok: true });
  });

  // ─── Math: focus facts ──────────────────────────────────────────────────────
  router.get('/api/players/:id/focus', (req, res) => res.json(db.getFocusFacts(Number(req.params.id))));
  router.post('/api/players/:id/focus', (req, res) => {
    const pid = Number(req.params.id);
    if (!pid) return res.status(400).json({ error: 'Bad id' });
    db.setFocusFacts(pid, req.body?.facts || []);
    if (mounted.math && mounted.math.pushFocus) mounted.math.pushFocus(pid, db.getFocusFacts(pid));
    res.json({ ok: true });
  });

  // ─── Spelling: per-player mastery & recommendations ─────────────────────────
  router.get('/api/players/:id/mastery', (req, res) => res.json(db.masteryWithWords(Number(req.params.id))));
  router.get('/api/players/:id/recommendations', (req, res) => res.json(db.recommendations(Number(req.params.id))));

  // ─── Spelling: word lists ───────────────────────────────────────────────────
  router.get('/api/word-lists', (req, res) => {
    res.json(db.allLists().map(l => ({ ...l, words: db.wordsForList(l.id) })));
  });
  router.post('/api/word-lists', (req, res) => {
    const { name, grade_level } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    res.json({ id: db.createList(name, grade_level || 1) });
  });
  router.post('/api/word-lists/:id/activate', (req, res) => {
    db.toggleListActive(Number(req.params.id), (req.body || {}).active !== false);
    notifyListChanged();
    res.json({ ok: true });
  });
  router.delete('/api/word-lists/:id', (req, res) => {
    db.deleteList(Number(req.params.id));
    notifyListChanged();
    res.json({ ok: true });
  });
  router.post('/api/word-lists/:id/words', (req, res) => {
    const { word, grade_level } = req.body || {};
    if (!word) return res.status(400).json({ error: 'Word required' });
    const { buildVariantPool } = require('../games/spelling-invaders/misspeller');
    const variants = buildVariantPool(word, grade_level || 1);
    const wid = db.addWord(Number(req.params.id), word, grade_level || 1, variants);
    res.json({ id: wid, word: String(word).toLowerCase(), variants });
  });
  router.delete('/api/word-lists/:listId/words/:wordId', (req, res) => {
    db.deactivateWord(Number(req.params.wordId));
    res.json({ ok: true });
  });

  // ─── Spelling: recent sessions ──────────────────────────────────────────────
  router.get('/api/sessions', (req, res) => res.json(db.allSessions()));

  // ─── Live snapshot across all games ─────────────────────────────────────────
  router.get('/api/live', (req, res) => {
    const live = {};
    for (const [key, g] of Object.entries(mounted)) live[key] = g.getLive ? g.getLive() : null;
    res.json(live);
  });

  return router;
};
