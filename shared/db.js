'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Unified database for all Family Games.
// One SQLite file holds shared player accounts/sessions plus each game's stats.
// Self-initializing: creates the FULL schema regardless of which game starts
// first (the games used to depend on math-gator having created players/sessions).
//
// DB location: $GAMES_DB_PATH, else <repo>/data/games.db
// ─────────────────────────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const DB_PATH = process.env.GAMES_DB_PATH
  || path.join(__dirname, '..', 'data', 'games.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log('Family Games DB:', DB_PATH);

db.exec(`
  -- ── Shared accounts ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL
  );

  -- ── Math Gator stats ──────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS player_stats (
    player_id   INTEGER PRIMARY KEY,
    best_score  INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS operation_stats (
    player_id         INTEGER NOT NULL,
    operation         TEXT NOT NULL,
    correct_eaten     INTEGER DEFAULT 0,
    incorrect_eaten   INTEGER DEFAULT 0,
    correct_presented INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, operation)
  );
  CREATE TABLE IF NOT EXISTS fact_stats (
    player_id       INTEGER NOT NULL,
    operation       TEXT NOT NULL,
    operand         INTEGER NOT NULL,
    correct_eaten   INTEGER DEFAULT 0,
    incorrect_eaten INTEGER DEFAULT 0,
    presented       INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, operation, operand)
  );
  CREATE TABLE IF NOT EXISTS focus_facts (
    player_id INTEGER NOT NULL,
    operation TEXT NOT NULL,
    operand   INTEGER NOT NULL,
    PRIMARY KEY (player_id, operation, operand)
  );

  -- ── Spelling games (Invaders + Sniper share these) ────────────────────────
  CREATE TABLE IF NOT EXISTS spell_word_lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    grade_level INTEGER NOT NULL DEFAULT 1,
    week_number INTEGER,
    theme       TEXT,
    active      INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS spell_words (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    word_list_id INTEGER NOT NULL REFERENCES spell_word_lists(id) ON DELETE CASCADE,
    word         TEXT NOT NULL COLLATE NOCASE,
    grade_level  INTEGER NOT NULL DEFAULT 1,
    active       INTEGER NOT NULL DEFAULT 1,
    variants     TEXT DEFAULT '[]',
    UNIQUE(word_list_id, word)
  );
  CREATE TABLE IF NOT EXISTS spell_mastery (
    player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    word_id         INTEGER NOT NULL REFERENCES spell_words(id) ON DELETE CASCADE,
    times_seen      INTEGER DEFAULT 0,
    times_correct   INTEGER DEFAULT 0,
    times_incorrect INTEGER DEFAULT 0,
    correct_passes  INTEGER DEFAULT 0,
    streak          INTEGER DEFAULT 0,
    mastered        INTEGER DEFAULT 0,
    last_seen       INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, word_id)
  );
  CREATE TABLE IF NOT EXISTS spell_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    word_list_id INTEGER REFERENCES spell_word_lists(id),
    player_ids   TEXT DEFAULT '[]',
    team_score   INTEGER DEFAULT 0,
    started_at   INTEGER DEFAULT (unixepoch()),
    ended_at     INTEGER
  );
  CREATE TABLE IF NOT EXISTS spell_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER REFERENCES spell_sessions(id),
    player_id     INTEGER REFERENCES players(id),
    word          TEXT NOT NULL,
    displayed_as  TEXT NOT NULL,
    is_misspelled INTEGER NOT NULL,
    shot_by       INTEGER,
    correct_shot  INTEGER,
    ts            INTEGER DEFAULT (unixepoch())
  );

  -- ── Typing Train ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS typing_progress (
    player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    level       INTEGER NOT NULL DEFAULT 1,   -- highest level unlocked
    updated_at  INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS typing_key_stats (
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    key_char      TEXT NOT NULL,
    presented     INTEGER DEFAULT 0,
    correct       INTEGER DEFAULT 0,
    incorrect     INTEGER DEFAULT 0,
    total_time_ms INTEGER DEFAULT 0,          -- summed time-to-press for correct hits
    PRIMARY KEY (player_id, key_char)
  );
  CREATE TABLE IF NOT EXISTS typing_laps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    level      INTEGER NOT NULL,
    story_id   INTEGER REFERENCES typing_stories(id) ON DELETE SET NULL,
    lap_ms     INTEGER NOT NULL,
    wpm        REAL,
    accuracy   REAL,
    splits     TEXT DEFAULT '[]',            -- cumulative ms per segment (ghost replay)
    ts         INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS typing_stories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    author      TEXT,
    source      TEXT,
    grade_level INTEGER NOT NULL DEFAULT 3,
    body        TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    builtin     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS typing_book_progress (
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    story_id   INTEGER NOT NULL REFERENCES typing_stories(id) ON DELETE CASCADE,
    para_index INTEGER NOT NULL DEFAULT 0,   -- paragraph the reader is up to
    updated_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (player_id, story_id)
  );

  -- ── Game Wizard: game ideas kids design with the AI helper ────────────────
  CREATE TABLE IF NOT EXISTS game_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id    INTEGER REFERENCES players(id) ON DELETE SET NULL,
    requester    TEXT,                         -- kid name for commit credit
    title        TEXT NOT NULL,
    slug         TEXT,
    summary      TEXT,
    subject      TEXT,                          -- e.g. spelling, math, typing
    goal         TEXT,                          -- 'struggle' | 'reinforce'
    requirements TEXT NOT NULL,                 -- full markdown requirements
    status       TEXT NOT NULL DEFAULT 'submitted',  -- submitted|approved|rejected|building|done
    created_at   INTEGER DEFAULT (unixepoch()),
    updated_at   INTEGER DEFAULT (unixepoch())
  );

  -- ── Key/value settings (e.g. the Game Wizard's Anthropic API key) ─────────
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- ── Skate 'n' Add ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS skate_stats (
    player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    correct     INTEGER DEFAULT 0,
    incorrect   INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    games       INTEGER DEFAULT 0,
    updated_at  INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS skate_fact_stats (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    a         INTEGER NOT NULL,
    b         INTEGER NOT NULL,
    correct   INTEGER DEFAULT 0,
    incorrect INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, a, b)
  );
`);

// Idempotent migrations for DBs created by older game versions
for (const m of [
  'ALTER TABLE spell_mastery ADD COLUMN correct_passes INTEGER DEFAULT 0',
  'ALTER TABLE spell_word_lists ADD COLUMN week_number INTEGER',
  'ALTER TABLE spell_word_lists ADD COLUMN theme TEXT',
]) { try { db.exec(m); } catch {} }

// ─── Prepared statements ─────────────────────────────────────────────────────
const q = {
  // Accounts
  findPlayer:        db.prepare('SELECT * FROM players WHERE username = ? COLLATE NOCASE'),
  getPlayerById:     db.prepare('SELECT id, username, created_at FROM players WHERE id = ?'),
  insertPlayer:      db.prepare('INSERT INTO players (username, password_hash) VALUES (?, ?)'),
  allPlayers:        db.prepare('SELECT id, username, created_at FROM players ORDER BY username COLLATE NOCASE'),
  updatePassword:    db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
  deletePlayer:      db.prepare('DELETE FROM players WHERE id = ?'),
  // Sessions
  getSession:        db.prepare('SELECT * FROM sessions WHERE token = ?'),
  insertSession:     db.prepare('INSERT INTO sessions (token, player_id) VALUES (?, ?)'),
  deleteSession:     db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteAllSessions: db.prepare('DELETE FROM sessions WHERE player_id = ?'),
  // Math stats
  initStats:         db.prepare('INSERT OR IGNORE INTO player_stats (player_id) VALUES (?)'),
  getPlayerStats:    db.prepare('SELECT * FROM player_stats WHERE player_id = ?'),
  getOpStats:        db.prepare('SELECT * FROM operation_stats WHERE player_id = ?'),
  getFactStats:      db.prepare('SELECT * FROM fact_stats WHERE player_id = ?'),
  updateBestScore:   db.prepare('UPDATE player_stats SET best_score = MAX(best_score, ?) WHERE player_id = ?'),
  incGames:          db.prepare('UPDATE player_stats SET total_games = total_games + 1 WHERE player_id = ?'),
  deletePlayerStats: db.prepare('DELETE FROM player_stats WHERE player_id = ?'),
  deleteOpStats:     db.prepare('DELETE FROM operation_stats WHERE player_id = ?'),
  deleteFactStats:   db.prepare('DELETE FROM fact_stats WHERE player_id = ?'),
  upsertOp:          db.prepare('INSERT OR IGNORE INTO operation_stats (player_id, operation) VALUES (?, ?)'),
  upsertFact:        db.prepare('INSERT OR IGNORE INTO fact_stats (player_id, operation, operand) VALUES (?, ?, ?)'),
  incOpCorrect:      db.prepare('UPDATE operation_stats SET correct_eaten   = correct_eaten   + 1 WHERE player_id = ? AND operation = ?'),
  incOpIncorrect:    db.prepare('UPDATE operation_stats SET incorrect_eaten = incorrect_eaten + 1 WHERE player_id = ? AND operation = ?'),
  incOpPresented:    db.prepare('UPDATE operation_stats SET correct_presented = correct_presented + 1 WHERE player_id = ? AND operation = ?'),
  incFactCorrect:    db.prepare('UPDATE fact_stats SET correct_eaten   = correct_eaten   + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
  incFactIncorrect:  db.prepare('UPDATE fact_stats SET incorrect_eaten = incorrect_eaten + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
  incFactPresented:  db.prepare('UPDATE fact_stats SET presented       = presented       + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
  // Focus facts
  getFocusFacts:     db.prepare('SELECT operation, operand FROM focus_facts WHERE player_id = ? ORDER BY operation, operand'),
  clearFocusFacts:   db.prepare('DELETE FROM focus_facts WHERE player_id = ?'),
  insertFocusFact:   db.prepare('INSERT OR IGNORE INTO focus_facts (player_id, operation, operand) VALUES (?, ?, ?)'),
  // Spelling: word lists
  allLists:          db.prepare('SELECT * FROM spell_word_lists ORDER BY grade_level, week_number, name'),
  activeList:        db.prepare('SELECT * FROM spell_word_lists WHERE active = 1 ORDER BY grade_level LIMIT 1'),
  getList:           db.prepare('SELECT * FROM spell_word_lists WHERE id = ?'),
  insertList:        db.prepare('INSERT INTO spell_word_lists (name, grade_level, week_number, theme) VALUES (?, ?, ?, ?)'),
  setActive:         db.prepare('UPDATE spell_word_lists SET active = (id = ?)'),
  setListActive:     db.prepare('UPDATE spell_word_lists SET active = ? WHERE id = ?'),
  deleteList:        db.prepare('DELETE FROM spell_word_lists WHERE id = ?'),
  recommendations:   db.prepare(`
    SELECT l.id, l.name, l.grade_level, l.week_number, l.theme,
           COUNT(sw.id) AS total_words,
           SUM(CASE WHEN m.mastered = 1 THEN 1 ELSE 0 END) AS mastered_words,
           ROUND(100.0 * SUM(CASE WHEN m.mastered = 1 THEN 1 ELSE 0 END) / COUNT(sw.id), 0) AS mastery_pct
    FROM spell_word_lists l
    JOIN spell_words sw ON sw.word_list_id = l.id AND sw.active = 1
    LEFT JOIN spell_mastery m ON m.word_id = sw.id AND m.player_id = ?
    WHERE l.active = 1
    GROUP BY l.id
    HAVING mastered_words * 1.0 / total_words >= 0.8
    ORDER BY l.grade_level, l.week_number
  `),
  // Spelling: words
  wordsForList:      db.prepare('SELECT * FROM spell_words WHERE word_list_id = ? AND active = 1 ORDER BY grade_level, word'),
  allWords:          db.prepare(`
    SELECT sw.* FROM spell_words sw
    JOIN spell_word_lists swl ON sw.word_list_id = swl.id
    WHERE sw.active = 1 AND swl.active = 1
    ORDER BY sw.grade_level, sw.word
  `),
  getWord:           db.prepare('SELECT * FROM spell_words WHERE id = ?'),
  insertWord:        db.prepare('INSERT OR IGNORE INTO spell_words (word_list_id, word, grade_level, variants) VALUES (?, ?, ?, ?)'),
  updateVariants:    db.prepare('UPDATE spell_words SET variants = ? WHERE id = ?'),
  deactivateWord:    db.prepare('UPDATE spell_words SET active = 0 WHERE id = ?'),
  // Spelling: mastery
  getMastery:        db.prepare('SELECT * FROM spell_mastery WHERE player_id = ? AND word_id = ?'),
  allMastery:        db.prepare('SELECT * FROM spell_mastery WHERE player_id = ?'),
  masteryWithWords:  db.prepare(`
    SELECT m.*, w.word, w.grade_level, l.name AS list_name
    FROM spell_mastery m
    JOIN spell_words w ON m.word_id = w.id
    JOIN spell_word_lists l ON w.word_list_id = l.id
    WHERE m.player_id = ?
    ORDER BY w.grade_level, w.word
  `),
  upsertMastery:     db.prepare(`
    INSERT INTO spell_mastery (player_id, word_id, times_seen, last_seen)
    VALUES (?, ?, 1, unixepoch())
    ON CONFLICT(player_id, word_id) DO UPDATE SET
      times_seen = times_seen + 1, last_seen = unixepoch()
  `),
  recordCorrect:     db.prepare(`
    UPDATE spell_mastery SET
      times_correct = times_correct + 1, streak = streak + 1,
      mastered = CASE WHEN correct_passes >= 10 AND times_correct + 1 >= 3 AND streak + 1 >= 5 THEN 1 ELSE mastered END
    WHERE player_id = ? AND word_id = ?
  `),
  recordPassedCorrect: db.prepare(`
    UPDATE spell_mastery SET
      correct_passes = correct_passes + 1, streak = streak + 1,
      mastered = CASE WHEN correct_passes + 1 >= 10 AND times_correct >= 3 AND streak + 1 >= 5 THEN 1 ELSE mastered END
    WHERE player_id = ? AND word_id = ?
  `),
  recordIncorrect:   db.prepare('UPDATE spell_mastery SET times_incorrect = times_incorrect + 1, streak = 0 WHERE player_id = ? AND word_id = ?'),
  masteredWords:     db.prepare('SELECT word_id FROM spell_mastery WHERE player_id = ? AND mastered = 1'),
  staleMastered:     db.prepare('SELECT m.word_id FROM spell_mastery m WHERE m.player_id = ? AND m.mastered = 1 ORDER BY m.last_seen ASC LIMIT 1'),
  deleteMastery:     db.prepare('DELETE FROM spell_mastery WHERE player_id = ?'),
  // Spelling: sessions/events
  insertSpellSession: db.prepare('INSERT INTO spell_sessions (word_list_id, player_ids) VALUES (?, ?)'),
  closeSpellSession:  db.prepare('UPDATE spell_sessions SET ended_at = unixepoch(), team_score = ? WHERE id = ?'),
  allSpellSessions:   db.prepare('SELECT * FROM spell_sessions ORDER BY started_at DESC LIMIT 50'),
  insertEvent:        db.prepare(`
    INSERT INTO spell_events (session_id, player_id, word, displayed_as, is_misspelled, shot_by, correct_shot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  // Typing Train
  typGetProgress:  db.prepare('SELECT * FROM typing_progress WHERE player_id = ?'),
  typInitProgress: db.prepare('INSERT OR IGNORE INTO typing_progress (player_id) VALUES (?)'),
  typSetLevel:     db.prepare('UPDATE typing_progress SET level = MAX(level, ?), updated_at = unixepoch() WHERE player_id = ?'),
  typKeyStats:     db.prepare('SELECT * FROM typing_key_stats WHERE player_id = ? ORDER BY key_char'),
  typUpsertKey:    db.prepare(`
    INSERT INTO typing_key_stats (player_id, key_char, presented, correct, incorrect, total_time_ms)
    VALUES (@pid, @key, @presented, @correct, @incorrect, @time)
    ON CONFLICT(player_id, key_char) DO UPDATE SET
      presented     = presented     + @presented,
      correct       = correct       + @correct,
      incorrect     = incorrect     + @incorrect,
      total_time_ms = total_time_ms + @time
  `),
  typInsertLap:    db.prepare(`
    INSERT INTO typing_laps (player_id, level, story_id, lap_ms, wpm, accuracy, splits)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  typBestLap:      db.prepare(`
    SELECT * FROM typing_laps WHERE player_id = ? AND level = ?
    ORDER BY lap_ms ASC LIMIT 1
  `),
  typRecentLaps:   db.prepare('SELECT * FROM typing_laps WHERE player_id = ? ORDER BY ts DESC LIMIT 20'),
  typLevelBest:    db.prepare(`
    SELECT p.username, MIN(l.lap_ms) AS best_ms, MAX(l.wpm) AS best_wpm
    FROM typing_laps l JOIN players p ON p.id = l.player_id
    WHERE l.level = ? GROUP BY l.player_id ORDER BY best_ms ASC LIMIT 20
  `),
  typDelProgress:  db.prepare('DELETE FROM typing_progress WHERE player_id = ?'),
  typDelKeyStats:  db.prepare('DELETE FROM typing_key_stats WHERE player_id = ?'),
  typDelLaps:      db.prepare('DELETE FROM typing_laps WHERE player_id = ?'),
  // Stories
  typAllStories:      db.prepare('SELECT id, title, author, source, grade_level, active, builtin, created_at, length(body) AS length FROM typing_stories ORDER BY grade_level, title'),
  typActiveStories:   db.prepare('SELECT id, title, author, source, grade_level FROM typing_stories WHERE active = 1 ORDER BY grade_level, title'),
  typGetStory:        db.prepare('SELECT * FROM typing_stories WHERE id = ?'),
  typStoryByTitle:    db.prepare('SELECT id FROM typing_stories WHERE title = ? AND builtin = 1'),
  typInsertStory:     db.prepare('INSERT INTO typing_stories (title, author, source, grade_level, body, builtin) VALUES (?, ?, ?, ?, ?, ?)'),
  typToggleStory:     db.prepare('UPDATE typing_stories SET active = ? WHERE id = ?'),
  typDeleteStory:     db.prepare('DELETE FROM typing_stories WHERE id = ?'),
  // Book position (resume where the reader left off)
  typGetBook:  db.prepare('SELECT para_index FROM typing_book_progress WHERE player_id = ? AND story_id = ?'),
  typSetBook:  db.prepare(`INSERT INTO typing_book_progress (player_id, story_id, para_index) VALUES (?, ?, ?)
    ON CONFLICT(player_id, story_id) DO UPDATE SET para_index = excluded.para_index, updated_at = unixepoch()`),
  typDelBook:  db.prepare('DELETE FROM typing_book_progress WHERE player_id = ?'),
  // Game Wizard requests
  grInsert: db.prepare(`INSERT INTO game_requests (player_id, requester, title, slug, summary, subject, goal, requirements, status)
    VALUES (@player_id, @requester, @title, @slug, @summary, @subject, @goal, @requirements, 'submitted')`),
  grForPlayer: db.prepare('SELECT id, title, subject, goal, status, created_at FROM game_requests WHERE player_id = ? ORDER BY created_at DESC'),
  grAll:       db.prepare(`SELECT gr.*, p.username FROM game_requests gr LEFT JOIN players p ON p.id = gr.player_id ORDER BY gr.created_at DESC`),
  grGet:       db.prepare('SELECT * FROM game_requests WHERE id = ?'),
  grSetStatus: db.prepare('UPDATE game_requests SET status = ?, updated_at = unixepoch() WHERE id = ?'),
  grDelete:    db.prepare('DELETE FROM game_requests WHERE id = ?'),
  // Settings
  setGet: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setPut: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  setDel: db.prepare('DELETE FROM settings WHERE key = ?'),
  // Skate 'n' Add
  skInit:        db.prepare('INSERT OR IGNORE INTO skate_stats (player_id) VALUES (?)'),
  skIncCorrect:  db.prepare('UPDATE skate_stats SET correct = correct + 1, best_streak = MAX(best_streak, ?), updated_at = unixepoch() WHERE player_id = ?'),
  skIncWrong:    db.prepare('UPDATE skate_stats SET incorrect = incorrect + 1, updated_at = unixepoch() WHERE player_id = ?'),
  skGet:         db.prepare('SELECT * FROM skate_stats WHERE player_id = ?'),
  skFactUp:      db.prepare(`INSERT INTO skate_fact_stats (player_id, a, b, correct, incorrect) VALUES (@pid, @a, @b, @c, @i)
    ON CONFLICT(player_id, a, b) DO UPDATE SET correct = correct + @c, incorrect = incorrect + @i`),
  skFacts:       db.prepare('SELECT a, b, correct, incorrect FROM skate_fact_stats WHERE player_id = ? ORDER BY a, b'),
  skAll:         db.prepare('SELECT s.*, p.username FROM skate_stats s JOIN players p ON p.id = s.player_id ORDER BY p.username COLLATE NOCASE'),
  skDelStats:    db.prepare('DELETE FROM skate_stats WHERE player_id = ?'),
  skDelFacts:    db.prepare('DELETE FROM skate_fact_stats WHERE player_id = ?'),
};

function createToken() { return crypto.randomBytes(32).toString('hex'); }

// ─── Accounts / auth (shared) ────────────────────────────────────────────────
function register(username, passwordHash) {
  const r = q.insertPlayer.run(username, passwordHash);
  q.initStats.run(r.lastInsertRowid);
  return r.lastInsertRowid;
}
function findPlayer(username)   { return q.findPlayer.get(username); }
function getPlayerById(id)      { return q.getPlayerById.get(id); }
function allPlayers()           { return q.allPlayers.all(); }
function createSession(pid)     { const t = createToken(); q.insertSession.run(t, pid); return t; }
function getSession(token)      { return token ? q.getSession.get(token) : null; }
function deleteSession(token)   { q.deleteSession.run(token); }
function resetPassword(pid, h)  { q.updatePassword.run(h, pid); q.deleteAllSessions.run(pid); }

// ─── Math Gator ──────────────────────────────────────────────────────────────
function getStats(pid) {
  return {
    playerStats:    q.getPlayerStats.get(pid) || { player_id: pid, best_score: 0, total_games: 0 },
    operationStats: q.getOpStats.all(pid),
    factStats:      q.getFactStats.all(pid),
  };
}
function getAllPlayerStats() {
  return q.allPlayers.all().map(p => ({
    ...p, ...getStats(p.id), focusFacts: q.getFocusFacts.all(p.id),
  }));
}
function getFocusFacts(pid)     { return q.getFocusFacts.all(pid); }
const setFocusFacts = db.transaction((pid, facts) => {
  q.clearFocusFacts.run(pid);
  for (const { operation, operand } of facts) q.insertFocusFact.run(pid, operation, operand);
});
function updateBestScore(pid, s){ q.updateBestScore.run(s, pid); }
function incrementGames(pid)    { q.incGames.run(pid); }

const recordPresented = db.transaction((pid, operation, operands) => {
  q.upsertOp.run(pid, operation);
  q.incOpPresented.run(pid, operation);
  for (const op of operands) { q.upsertFact.run(pid, operation, op); q.incFactPresented.run(pid, operation, op); }
});
const recordEaten = db.transaction((pid, operation, operands, isCorrect) => {
  q.upsertOp.run(pid, operation);
  if (isCorrect) {
    q.incOpCorrect.run(pid, operation);
    for (const op of operands) { q.upsertFact.run(pid, operation, op); q.incFactCorrect.run(pid, operation, op); }
  } else {
    q.incOpIncorrect.run(pid, operation);
    for (const op of operands) { q.upsertFact.run(pid, operation, op); q.incFactIncorrect.run(pid, operation, op); }
  }
});

const deletePlayer = db.transaction(pid => {
  q.deleteAllSessions.run(pid);
  q.deletePlayerStats.run(pid);
  q.deleteOpStats.run(pid);
  q.deleteFactStats.run(pid);
  q.clearFocusFacts.run(pid);
  q.deleteMastery.run(pid);
  q.typDelProgress.run(pid);
  q.typDelKeyStats.run(pid);
  q.typDelLaps.run(pid);
  q.typDelBook.run(pid);
  q.skDelStats.run(pid);
  q.skDelFacts.run(pid);
  q.deletePlayer.run(pid);
});

// ─── Spelling (Invaders + Sniper) ────────────────────────────────────────────
function allLists()             { return q.allLists.all(); }
function activeList()           { return q.activeList.get(); }
function getList(id)            { return q.getList.get(id); }
function createList(name, lvl, week, theme) { return q.insertList.run(name, lvl, week ?? null, theme ?? null).lastInsertRowid; }
function recommendations(pid)   { return q.recommendations.all(pid); }
function setActiveList(id)      { q.setActive.run(id); }
function toggleListActive(id, v){ q.setListActive.run(v ? 1 : 0, id); }
function deleteList(id)         { q.deleteList.run(id); }
function allWords()             { return q.allWords.all(); }
function addWord(listId, word, level, variants) {
  return q.insertWord.run(listId, word.toLowerCase(), level, JSON.stringify(variants)).lastInsertRowid;
}
function wordsForList(listId)         { return q.wordsForList.all(listId); }
function updateVariants(id, variants) { q.updateVariants.run(JSON.stringify(variants), id); }
function deactivateWord(id)           { q.deactivateWord.run(id); }
function touchMastery(pid, wid)       { q.upsertMastery.run(pid, wid); }
function recordCorrect(pid, wid)      { q.recordCorrect.run(pid, wid); }
function recordPassedCorrect(pid, wid){ q.recordPassedCorrect.run(pid, wid); }
function recordIncorrect(pid, wid)    { q.recordIncorrect.run(pid, wid); }
function masteredWordIds(pid)         { return q.masteredWords.all(pid).map(r => r.word_id); }
function staleMasteredWord(pid)       { return q.staleMastered.get(pid); }
function allMastery(pid)              { return q.allMastery.all(pid); }
function getMastery(pid, wid)         { return q.getMastery.get(pid, wid); }
function masteryWithWords(pid)        { return q.masteryWithWords.all(pid); }
function startSession(listId, ids)    { return q.insertSpellSession.run(listId ?? null, JSON.stringify(ids)).lastInsertRowid; }
function closeSession(id, score)      { q.closeSpellSession.run(score, id); }
function allSessions()                { return q.allSpellSessions.all(); }
function logEvent(sid, pid, word, displayedAs, isMisspelled, shotBy, correctShot) {
  q.insertEvent.run(sid ?? null, pid ?? null, word, displayedAs,
    isMisspelled ? 1 : 0, shotBy ?? null,
    correctShot == null ? null : (correctShot ? 1 : 0));
}

// ─── Typing Train ────────────────────────────────────────────────────────────
function typGetProgress(pid) {
  q.typInitProgress.run(pid);
  return q.typGetProgress.get(pid) || { player_id: pid, level: 1 };
}
function typUnlockLevel(pid, level) { q.typInitProgress.run(pid); q.typSetLevel.run(level, pid); }
function typGetKeyStats(pid)        { return q.typKeyStats.all(pid); }
const typRecordKeyStats = db.transaction((pid, perKey) => {
  for (const [key, s] of Object.entries(perKey)) {
    q.typUpsertKey.run({ pid, key, presented: s.presented|0, correct: s.correct|0, incorrect: s.incorrect|0, time: s.time|0 });
  }
});
function typRecordLap(pid, level, storyId, lapMs, wpm, accuracy, splits) {
  return q.typInsertLap.run(pid, level, storyId ?? null, Math.round(lapMs), wpm ?? null, accuracy ?? null, JSON.stringify(splits || [])).lastInsertRowid;
}
function typBestLap(pid, level)   { return q.typBestLap.get(pid, level); }
function typRecentLaps(pid)       { return q.typRecentLaps.all(pid); }
function typLevelLeaderboard(lvl) { return q.typLevelBest.all(lvl); }

function typAllStories()          { return q.typAllStories.all(); }
function typActiveStories()       { return q.typActiveStories.all(); }
function typGetStory(id)          { return q.typGetStory.get(id); }
function typAddStory(title, author, source, grade, body, builtin) {
  return q.typInsertStory.run(title, author ?? null, source ?? null, grade || 3, body, builtin ? 1 : 0).lastInsertRowid;
}
function typSeedStory(title, author, source, grade, body) {
  if (q.typStoryByTitle.get(title)) return null;   // already seeded
  return typAddStory(title, author, source, grade, body, 1);
}
function typToggleStory(id, active) { q.typToggleStory.run(active ? 1 : 0, id); }
function typDeleteStory(id)         { q.typDeleteStory.run(id); }
function typGetBookPos(pid, sid)    { const r = q.typGetBook.get(pid, sid); return r ? r.para_index : 0; }
function typSetBookPos(pid, sid, i) { q.typSetBook.run(pid, sid, i | 0); }

// ─── Game Wizard requests ────────────────────────────────────────────────────
function gameReqAdd(r)              { return q.grInsert.run(r).lastInsertRowid; }
function gameReqForPlayer(pid)      { return q.grForPlayer.all(pid); }
function gameReqAll()               { return q.grAll.all(); }
function gameReqGet(id)             { return q.grGet.get(id); }
function gameReqSetStatus(id, s)    { q.grSetStatus.run(s, id); }
function gameReqDelete(id)          { q.grDelete.run(id); }

// ─── Settings (key/value) ────────────────────────────────────────────────────
function getSetting(k)    { const r = q.setGet.get(k); return r ? r.value : null; }
function setSetting(k, v) { q.setPut.run(k, v); }
function delSetting(k)    { q.setDel.run(k); }

// ─── Skate 'n' Add ───────────────────────────────────────────────────────────
const skateRecord = db.transaction((pid, a, b, isCorrect, streak) => {
  q.skInit.run(pid);
  if (isCorrect) { q.skIncCorrect.run(streak | 0, pid); q.skFactUp.run({ pid, a, b, c: 1, i: 0 }); }
  else           { q.skIncWrong.run(pid);               q.skFactUp.run({ pid, a, b, c: 0, i: 1 }); }
});
function skateStats(pid) { q.skInit.run(pid); return q.skGet.get(pid); }
function skateFacts(pid) { return q.skFacts.all(pid); }
function skateAll()      { return q.skAll.all(); }

module.exports = {
  // accounts / auth
  register, findPlayer, getPlayerById, getPlayer: getPlayerById, allPlayers,
  createSession, getSession, deleteSession, resetPassword, deletePlayer,
  // math
  getStats, getAllPlayerStats, getFocusFacts, setFocusFacts,
  recordPresented, recordEaten, updateBestScore, incrementGames,
  // spelling
  allLists, activeList, getList, createList, recommendations,
  setActiveList, toggleListActive, deleteList,
  allWords, addWord, wordsForList, updateVariants, deactivateWord,
  touchMastery, recordCorrect, recordPassedCorrect, recordIncorrect,
  masteredWordIds, staleMasteredWord, allMastery, getMastery, masteryWithWords,
  startSession, closeSession, allSessions, logEvent,
  // typing train
  typGetProgress, typUnlockLevel, typGetKeyStats, typRecordKeyStats,
  typRecordLap, typBestLap, typRecentLaps, typLevelLeaderboard,
  typAllStories, typActiveStories, typGetStory, typAddStory, typSeedStory,
  typToggleStory, typDeleteStory, typGetBookPos, typSetBookPos,
  // game wizard
  gameReqAdd, gameReqForPlayer, gameReqAll, gameReqGet, gameReqSetStatus, gameReqDelete,
  // settings
  getSetting, setSetting, delSetting,
  // skate 'n' add
  skateRecord, skateStats, skateFacts, skateAll,
  // raw handle (for unified teacher aggregate queries if needed)
  _db: db,
};
