'use strict';
// ─── Spelling Sniper ─────────────────────────────────────────────────────────
// Shoot the misspelled words; when hit, the game freezes and you type the
// correct spelling. Let correctly-spelled words fall safely.
// Mountable module: createGame({ base, io }) → { router, io, getLive, broadcast, kickPlayer }
const express = require('express');
const path    = require('path');
const db      = require('../../shared/db');
const { requireAuth } = require('../../shared/auth');
const { buildVariantPool } = require('./misspeller');
const { BUILT_IN }         = require('./wordLists');
const { WEEKLY }           = require('./weeklyWordLists');

const SHARED_AUDIO = path.join(__dirname, '..', '..', 'shared', 'audio');

module.exports = function createSpellingSniper({ base = '/sniper', io }) {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(path.join(__dirname, 'public')));
  router.use(express.static(SHARED_AUDIO));

  // ─── Seed built-in word lists (shared with Invaders; idempotent) ────────────
  function seedWordLists() {
    const existing = db.allLists();
    const existingNames = new Set(existing.map(l => l.name));
    for (const listDef of BUILT_IN) {
      if (!existingNames.has(listDef.name)) {
        const listId = db.createList(listDef.name, listDef.grade_level);
        for (const { word, level } of listDef.words) db.addWord(listId, word, level, buildVariantPool(word, level));
      }
    }
    const weeklyKey = (g, w) => `Grade ${g} Week ${w}`;
    const existingKeys = new Set(existing.map(l => weeklyKey(l.grade_level, l.week_number)));
    for (const listDef of WEEKLY) {
      const key = weeklyKey(listDef.grade, listDef.week);
      if (!existingKeys.has(key)) {
        const name = `Grade ${listDef.grade} Week ${listDef.week}: ${listDef.theme}`;
        const listId = db.createList(name, listDef.grade, listDef.week, listDef.theme);
        for (const word of listDef.words) db.addWord(listId, word, listDef.grade, buildVariantPool(word, listDef.grade));
      }
    }
    const builtInNames = new Set(BUILT_IN.map(l => l.name));
    for (const list of db.allLists()) {
      if (builtInNames.has(list.name) && !list.active) db.toggleListActive(list.id, true);
      for (const w of db.wordsForList(list.id)) db.updateVariants(w.id, buildVariantPool(w.word, w.grade_level));
    }
  }
  seedWordLists();

  // ─── Game constants ─────────────────────────────────────────────────────────
  const CANVAS_W        = 900;
  const CANVAS_H        = 600;
  const WORD_SPEED      = 1.3;
  const ACTIVE_WORDS    = 12;
  const TARGET_DENSITY  = 6;
  const SPAWN_INTERVAL  = 1100;
  const MISSPELL_CHANCE = 0.60;
  const FLUENCY_EVERY   = 8;
  const LIVES_START     = 5;
  const FREEZE_TIMEOUT  = 20000;
  const MAX_PLAYERS     = 8;

  const PLAYER_COLORS = [
    '#44aaff','#ff4455','#44dd88','#ffaa00','#cc44ff','#00ccff','#ff6644','#ffdd33',
    '#ff77cc','#00ffaa','#7744ff','#ff3300','#55ffff','#aaff00','#ff8800','#ee44aa',
  ];
  const ALLOWED_COLORS = new Set(PLAYER_COLORS);

  let gameState = null;
  let gameLoop  = null;

  function makeGameState() {
    return {
      phase: 'playing', players: {}, words: {}, teamScore: 0, sessionId: null,
      tick: 0, nextWordId: 1, lastSpawn: 0, wordsHandled: 0, allWords: [],
      paused: false, manualPause: false, frozenWordId: null, frozenBySocket: null, freezeTimer: null,
    };
  }
  function playerLevel(player) {
    if (!player.activeSet || !player.activeSet.length) return 1;
    return Math.min(...player.activeSet.map(w => w.grade_level));
  }
  function initState() {
    if (gameState && gameState.freezeTimer) clearTimeout(gameState.freezeTimer);
    gameState = makeGameState();
    gameState.allWords  = db.allWords();
    gameState.lastSpawn = Date.now();
    startGameLoop();
    io.emit('lobbyReset');
  }

  function buildActiveSet(playerId) {
    if (!gameState.allWords.length) return [];
    const mastered  = new Set(db.masteredWordIds(playerId));
    const available = gameState.allWords.filter(w => !mastered.has(w.id));
    return available.slice(0, ACTIVE_WORDS).map(w => ({ ...w, variants: JSON.parse(w.variants || '[]') }));
  }
  function getNextWord(player) {
    if (!player.activeSet.length) return null;
    const { wordsHandled } = gameState;
    if (wordsHandled > 0 && wordsHandled % FLUENCY_EVERY === 0) {
      const stale = db.staleMasteredWord(player.playerId);
      if (stale) {
        const w = gameState.allWords.find(x => x.id === stale.word_id);
        if (w) return { ...w, variants: JSON.parse(w.variants || '[]'), fluency: true };
      }
    }
    return player.activeSet[Math.floor(Math.random() * player.activeSet.length)];
  }
  function promoteWord(player, wordId) {
    const mastery = db.getMastery(player.playerId, wordId);
    if (!mastery || !mastery.mastered) return;
    player.activeSet = player.activeSet.filter(w => w.id !== wordId);
    const mastered = new Set(db.masteredWordIds(player.playerId));
    const inSet    = new Set(player.activeSet.map(w => w.id));
    const next = gameState.allWords.find(w => !mastered.has(w.id) && !inSet.has(w.id));
    const masteredDef = gameState.allWords.find(w => w.id === wordId);
    if (masteredDef) {
      player.sessionStats.masteredWords.push({ word: masteredDef.word, grade_level: masteredDef.grade_level });
      io.to(player.socketId).emit('wordMastered', { word: masteredDef.word, grade: masteredDef.grade_level });
    }
    if (next) player.activeSet.push({ ...next, variants: JSON.parse(next.variants || '[]') });
  }

  function wordHalfW(text) { return (text.length * 11 + 28) / 2; }
  function findSpawnX(text) {
    const newHW = wordHalfW(text);
    const pad = 20, minX = newHW + pad, maxX = CANVAS_W - newHW - pad;
    if (minX >= maxX) return CANVAS_W / 2;
    const nearby = Object.values(gameState.words).filter(w => w.y < 80);
    for (let attempt = 0; attempt < 25; attempt++) {
      const x = minX + Math.random() * (maxX - minX);
      if (nearby.every(w => Math.abs(x - w.x) >= newHW + wordHalfW(w.displayAs) + pad)) return x;
    }
    return minX + Math.random() * (maxX - minX);
  }
  function randomCaps(str) {
    return str.split('').map(c => /[a-z]/.test(c) && Math.random() < 0.4 ? c.toUpperCase() : c).join('');
  }
  function spawnWord() {
    const playerList = Object.values(gameState.players).filter(p => p.active);
    if (!playerList.length || !gameState.allWords.length) return;
    if (Object.keys(gameState.words).length >= playerList.length * TARGET_DENSITY) return;
    const owner   = playerList[Math.floor(Math.random() * playerList.length)];
    const wordDef = getNextWord(owner);
    if (!wordDef) return;
    const variants = wordDef.variants || [];
    const isMisspelled = variants.length > 0 && Math.random() < MISSPELL_CHANCE;
    let displayAs = isMisspelled ? variants[Math.floor(Math.random() * variants.length)] : wordDef.word;
    if (wordDef.grade_level >= 7) displayAs = randomCaps(displayAs);
    const id = `w${gameState.nextWordId++}`;
    gameState.words[id] = {
      id, wordId: wordDef.id, word: wordDef.word, displayAs, isMisspelled,
      ownerId: owner.socketId, ownerColor: owner.color, x: findSpawnX(displayAs),
      y: -30, speed: WORD_SPEED, fluency: wordDef.fluency || false,
    };
    gameState.wordsHandled++;
    db.touchMastery(owner.playerId, wordDef.id);
    owner.sessionStats.seen++;
  }
  function processWords() {
    for (const [wid, word] of Object.entries(gameState.words)) {
      if (wid === gameState.frozenWordId) continue;
      word.y += word.speed;
      if (word.y > CANVAS_H + 40) {
        const owner = gameState.players[word.ownerId];
        if (word.isMisspelled) {
          if (owner) {
            owner.lives = Math.max(0, owner.lives - 1);
            if (owner.lives === 0) eliminatePlayer(owner);
            db.recordIncorrect(owner.playerId, word.wordId);
            owner.sessionStats.incorrect++;
            io.emit('missedMisspelling', { word: word.word, displayAs: word.displayAs, ownerId: word.ownerId });
          }
        } else if (owner) {
          db.recordPassedCorrect(owner.playerId, word.wordId);
          promoteWord(owner, word.wordId);
        }
        delete gameState.words[wid];
      }
    }
  }
  function eliminatePlayer(player) {
    player.active = false;
    const leaderboard = Object.values(gameState.players)
      .map(p => ({ username: p.username, color: p.color, mastered: p.sessionStats.masteredWords.length, score: p.score, active: p.active }))
      .sort((a, b) => b.mastered - a.mastered || b.score - a.score);
    io.to(player.socketId).emit('eliminated', { leaderboard });
    if (Object.values(gameState.players).filter(p => p.active).length === 0) endGame();
  }
  function endGame() {
    if (gameState.phase !== 'playing') return;
    gameState.phase = 'ended';
    clearInterval(gameLoop); gameLoop = null;
    if (gameState.freezeTimer) clearTimeout(gameState.freezeTimer);
    if (gameState.sessionId) db.closeSession(gameState.sessionId, gameState.teamScore);
    for (const p of Object.values(gameState.players)) {
      const shots = p.sessionStats.correct + p.sessionStats.incorrect;
      io.to(p.socketId).emit('sessionResults', {
        myScore: p.score, teamScore: gameState.teamScore, stats: p.sessionStats,
        accuracy: shots > 0 ? Math.round(p.sessionStats.correct / shots * 100) : 0,
      });
    }
    io.emit('gameOver', { teamScore: gameState.teamScore });
    setTimeout(initState, 8000);
  }
  function getLiveSnapshot() {
    if (!gameState) return { phase: 'idle' };
    return {
      phase: gameState.phase, teamScore: gameState.teamScore,
      players: Object.values(gameState.players).map(p => ({ username: p.username, color: p.color, x: p.x, lives: p.lives, score: p.score, active: p.active })),
      wordCount: Object.keys(gameState.words).length,
    };
  }
  function broadcastState() {
    io.emit('state', {
      phase: gameState.phase, paused: gameState.paused, teamScore: gameState.teamScore, tick: gameState.tick,
      ships: Object.values(gameState.players).map(p => ({
        id: p.socketId, username: p.username, color: p.color, shipType: p.shipType,
        x: p.x, lives: p.lives, score: p.score, active: p.active, seat: p.seat,
        level: playerLevel(p), mastered: p.sessionStats.masteredWords.length,
      })),
      words: Object.values(gameState.words).map(w => ({
        id: w.id, text: w.displayAs, x: w.x, y: w.y, color: w.ownerColor, frozen: w.id === gameState.frozenWordId,
      })),
      frozenBy: gameState.frozenWordId ? (() => { const p = gameState.players[gameState.frozenBySocket]; return p ? p.username : ''; })() : null,
    });
  }
  function startGameLoop() {
    if (gameLoop) return;
    gameLoop = setInterval(() => {
      if (gameState.phase !== 'playing') return;
      if (gameState.paused || gameState.manualPause) { broadcastState(); return; }
      gameState.tick++;
      processWords();
      const now = Date.now();
      if (now - gameState.lastSpawn > SPAWN_INTERVAL) { spawnWord(); gameState.lastSpawn = now; }
      broadcastState();
    }, 50);
  }
  function resumeFromFreeze() {
    if (gameState.freezeTimer) clearTimeout(gameState.freezeTimer);
    gameState.paused = false; gameState.frozenWordId = null; gameState.frozenBySocket = null; gameState.freezeTimer = null;
  }
  initState();

  // ─── Socket.io ───────────────────────────────────────────────────────────────
  io.on('connection', socket => {
    let playerId = null;

    socket.on('join', ({ token, color, shipType }) => {
      const session = db.getSession(token);
      if (!session) { socket.emit('authError'); return; }
      const player = db.getPlayerById(session.player_id);
      if (!player) { socket.emit('authError'); return; }
      playerId = player.id;
      const activePlayers = Object.values(gameState.players).filter(p => p.active && p.socketId !== socket.id);
      const usedSeats  = new Set(activePlayers.map(p => p.seat));
      const usedColors = new Set(activePlayers.map(p => p.color));
      const seat = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(s => !usedSeats.has(s));
      if (seat === undefined) { socket.emit('gameFull'); return; }
      if (!gameState.sessionId) gameState.sessionId = db.startSession(null, [player.id]);
      let playerColor = ALLOWED_COLORS.has(color) && !usedColors.has(color)
        ? color : PLAYER_COLORS.find(c => !usedColors.has(c)) ?? PLAYER_COLORS[seat % PLAYER_COLORS.length];
      const validShip = Number.isInteger(shipType) && shipType >= 0 && shipType <= 15 ? shipType : 0;
      const seatX = Math.round(62 + seat * ((900 - 124) / (MAX_PLAYERS - 1)));
      gameState.players[socket.id] = {
        socketId: socket.id, playerId: player.id, username: player.username, color: playerColor,
        shipType: validShip, seat, x: seatX, lives: LIVES_START, score: 0, active: true,
        activeSet: buildActiveSet(player.id),
        sessionStats: { seen: 0, correct: 0, incorrect: 0, masteredWords: [] },
      };
      const newPlayer = gameState.players[socket.id];
      socket.emit('joined', { seat, color: playerColor, shipType: validShip, username: player.username, phase: gameState.phase, level: playerLevel(newPlayer) });
      io.emit('roster', Object.values(gameState.players).map(p => ({ username: p.username, color: p.color, seat: p.seat })));
    });

    socket.on('input', ({ x }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.active) return;
      if (x !== undefined) player.x = Math.max(30, Math.min(CANVAS_W - 30, x));
    });
    socket.on('bulletFired', ({ x }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.active || gameState.phase !== 'playing') return;
      socket.broadcast.emit('bulletFired', { shooterId: socket.id, x, color: player.color });
    });
    socket.on('shootWord', ({ wordId }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.active || gameState.phase !== 'playing') return;
      if (gameState.paused) return;
      const word = gameState.words[wordId];
      if (!word) return;
      if (word.isMisspelled) {
        gameState.paused = true; gameState.frozenWordId = wordId; gameState.frozenBySocket = socket.id;
        gameState.freezeTimer = setTimeout(() => {
          if (gameState.frozenWordId === wordId) { resumeFromFreeze(); io.emit('freezeTimeout', { wordId }); }
        }, FREEZE_TIMEOUT);
        socket.emit('spellCheck', { wordId, displayAs: word.displayAs });
        io.emit('gameFrozen', { by: player.username });
      } else {
        io.emit('badShot', { displayAs: word.displayAs, shooter: player.username });
      }
    });
    socket.on('spellAnswer', ({ wordId, answer }) => {
      const player = gameState.players[socket.id];
      if (!player || !player.active) return;
      if (gameState.frozenWordId !== wordId) return;
      if (gameState.frozenBySocket !== socket.id) return;
      const word = gameState.words[wordId];
      if (!word) { resumeFromFreeze(); io.emit('gameResumed', {}); return; }
      const guess   = String(answer).trim().toLowerCase();
      const correct = guess === word.word.toLowerCase();
      if (correct) {
        const wordDef = gameState.allWords.find(w => w.id === word.wordId);
        const points  = wordDef ? wordDef.grade_level * 15 : 15;
        player.score += points; player.sessionStats.correct++; gameState.teamScore += points;
        db.recordCorrect(player.playerId, word.wordId);
        promoteWord(player, word.wordId);
        db.logEvent(gameState.sessionId, player.playerId, word.word, word.displayAs, true, player.playerId, true);
        delete gameState.words[wordId];
        resumeFromFreeze();
        io.emit('spellResult', { correct: true, word: word.word, displayAs: word.displayAs, points, shooter: player.username });
      } else {
        player.sessionStats.incorrect++;
        db.recordIncorrect(player.playerId, word.wordId);
        db.logEvent(gameState.sessionId, player.playerId, word.word, word.displayAs, true, player.playerId, false);
        resumeFromFreeze();
        io.emit('spellResult', { correct: false, word: word.word, displayAs: word.displayAs, guess, shooter: player.username });
      }
      io.emit('gameResumed', {});
    });
    socket.on('pause', () => {
      const player = gameState.players[socket.id];
      if (!player || !player.active || gameState.phase !== 'playing') return;
      if (gameState.paused || gameState.manualPause) return;
      gameState.manualPause = true;
      io.emit('gamePaused', { by: player.username });
    });
    socket.on('resume', () => {
      if (!gameState.manualPause) return;
      gameState.manualPause = false;
      io.emit('gameUnpaused', {});
    });
    socket.on('disconnect', () => {
      const player = gameState.players[socket.id];
      if (player) {
        if (gameState.frozenBySocket === socket.id) { resumeFromFreeze(); io.emit('gameResumed', { disconnected: true }); }
        player.active = false;
        delete gameState.players[socket.id];
        io.emit('roster', Object.values(gameState.players).map(p => ({ username: p.username, color: p.color, seat: p.seat })));
        if (Object.values(gameState.players).filter(p => p.active).length === 0 && gameState.phase === 'playing') endGame();
      }
    });
  });

  // ─── Game-specific REST ─────────────────────────────────────────────────────
  router.get('/api/my-mastery', requireAuth, (req, res) => res.json(db.masteryWithWords(req.player.id)));

  // ─── Teacher hooks ──────────────────────────────────────────────────────────
  function kickPlayer(dbId, reason) {
    for (const p of Object.values(gameState.players)) {
      if (p.playerId === dbId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.emit('kicked', { reason: reason || 'Account removed by teacher' }); s.disconnect(true); }
      }
    }
  }

  return { router, io, getLive: getLiveSnapshot, broadcast: (e, d) => io.emit(e, d), kickPlayer };
};
