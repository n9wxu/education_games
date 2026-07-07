# Family Games — House Rules (shared context for all agents)

Every agent in the game-factory pipeline MUST read this file first and keep new
work compatible with these conventions. The goal of the whole pipeline: **turn a
kid's game idea into a game they can play, on the real server, in under an hour.**

## The product
One Node process (`server.js`) serves several educational web games on **one
port** plus a selector menu and a unified teacher dashboard. Games today:
Math Gator (`/math`), Spelling Invaders (`/spelling`), Spelling Sniper
(`/sniper`), Typing Train (`/typing`). Shared SQLite DB, single sign-on across
games, self-updating from git.

## Architecture a new game MUST follow
- **Module:** `games/<slug>/index.js` exports a factory
  `module.exports = function createGame({ base, io }) { … return { router, io, getLive, broadcast, kickPlayer }; }`
  - `router` = an `express.Router()` that serves `public/` static and the game's
    `/api/...` routes.
  - `io` = a Socket.IO server the orchestration passes in, bound to
    `<base>/socket.io` (each game gets its own path so they don't collide).
  - `getLive()` → snapshot for the teacher Live tab; `broadcast(ev,data)` → `io.emit`;
    `kickPlayer(dbId, reason)` → disconnect a player's sockets.
- **Register it:** add one line to the `GAMES` array in `server.js`
  (`{ key, base, title, factory: require('./games/<slug>') }`).
- **Client:** `games/<slug>/public/index.html` + `game.js`. Because the game is
  served under `<base>`, every absolute URL must be prefixed:
  `io({ path:'<base>/socket.io' })`, `fetch('<base>/api/...')`,
  `<script src="<base>/socket.io/socket.io.js">`, assets under `<base>/...`.
- **Accounts/auth:** never re-implement. Use `shared/auth.js`
  (`router()` login/register/logout/me is mounted per game by the server;
  `requireAuth` middleware; `playerFromSocket(socket)` for socket auth). Tokens
  are shared across games (single sign-on).
- **Database:** add tables + prepared statements + helpers to `shared/db.js`.
  The schema is **self-initializing** (`CREATE TABLE IF NOT EXISTS`) and must not
  depend on another game running first. Add cleanup for your tables to the
  `deletePlayer` transaction. Namespace tables with the game slug (e.g. `typing_*`).
  DB path is `GAMES_DB_PATH` (default `data/games.db`).
- **Teacher integration:** add read-only progress endpoints + any admin endpoints
  to `portal/teacher.js` (gated by the shared password middleware) and a tab in
  `portal/teacher.html`. Live actions fan out via the game instance's
  `broadcast` / `kickPlayer`.
- **Selector:** add a card to `portal/public/index.html`.

## Multiplayer is required (and must be safe for learning)
**Every game is multiplayer** — never design a single-player-only game. The
requirements and design MUST state exactly which multiplayer model is used and
must guarantee that **no player can disrupt another player's learning**. Choose
along this spectrum:
- **Observe-only** — players see each other's state/position but cannot affect it
  (e.g. Typing Train: live train positions + ghost of a best lap). Safest default.
- **Cooperative** — players contribute to a shared goal (e.g. Spelling Invaders'
  shared team score); one player's mistakes don't punish another's progress.
- **Limited interaction** — bounded, benign interactions only (e.g. Math Gator's
  "steal"): they may add friendly competition but must not force errors on,
  block, harass, or erase another player's learning progress.

Hard rules for any interaction: it is opt-in-safe (can't be griefed), never
inserts wrong answers into someone else's stream, never blocks another player from
answering, and each player's own accuracy/mastery/progress is recorded from their
own actions only. Per-player learning state is always isolated in the DB even when
the play surface is shared. If a proposed mechanic can't meet these rules, redesign
it toward the observe-only end.

## Scoring must require the skill (anti-cheat)
A game must be built so a child **cannot get a good score or unlock progress
without actually exercising the target skill**. No mash-to-win, spam, brute-force,
or trial-and-error-without-cost paths. The score/mastery signal must come from the
child *producing or committing the correct answer*, never from reaching a threshold
of raw actions or from stumbling onto the answer for free.

Two families of trap to avoid:

1. **Reaching a threshold ≠ demonstrating the skill.** A counting game where pressing
   space N times = "shooting" N targets, meant to teach counting: if the game just
   counts presses and advances the moment the count reaches the target, a child can
   mash the space bar without counting. Fix: require the child to **commit** their
   count — press N times and then press **Enter** to declare "done" — and score the
   committed count against the target (an extra press, a short count, or a wrong count
   fails). Derive mastery from **first-try correctness**, not from hitting a threshold.
   *But match the input to the number range:* press-to-count with an Enter commit only
   works for **small** counts. For larger numbers, have the child **enter or select the
   numeral** instead — at large N the failures are mechanical (double-strikes, missed
   presses, key bounce), i.e. *input noise*, not counting-skill errors, and scoring them
   would punish skill unfairly. General rule: don't let mechanical input error get
   counted as a skill mistake — pick an input that measures the skill cleanly.
2. **The prompt must not reveal the answer the child is meant to produce.** A spelling
   game that *displays the word as text* for the child to type is copying, not spelling —
   no learning happens. Fix: present the word another way that requires recall — **spoken
   audio** ("the game says the word, the player spells it"), or a picture/definition — so
   the child must produce the spelling from knowledge, not transcribe it. Same rule for
   any skill: don't show the sum next to the addition problem, the definition next to the
   word, etc.

Every game is audited by the **gameplay-analyzer** for these cheat paths; the
design must close them; and a test must prove that a cheat strategy (mashing,
spamming, cycling all choices, over-shooting) does **not** score or advance.

## Testing conventions (headless, no browser)
- Boot the server on a temp port + throwaway DB:
  `GAMES_DB_PATH=/tmp/x.db PORT=3990 TEACHER_PASSWORD=t node server.js`.
- HTTP checks with Node's global `fetch`; sockets with `socket.io-client`
  (`npm install socket.io-client --no-save`), run the probe **from the project dir**
  so it resolves. Assert: pages 200, `<base>/socket.io` handshake 200, register →
  token, socket join, core gameplay events, DB persistence, teacher endpoints,
  and that the other games still return 200.
- Client canvas/feel can't be verified headlessly — call that out for human review.

## Deploy / verify (the real server)
- Server: `ssh root@david.local`. Live app is `/opt/education-games` on port 3000,
  systemd unit `education-games`, self-updates via `git pull` in `update.sh`.
- Ship by: commit to `main` → push → `ssh root@david.local /opt/education-games/update.sh`
  (pulls + `npm install` + restarts). Then verify `http://david.local:3000/<base>/`.
- **Do not disturb** the running games or real player data. Test with throwaway
  accounts and **delete them afterward** (usernames prefixed, e.g. `qa_…`).
- Teacher password on the live box defaults to `teacher`.
- Commit messages: conventional, imperative subject. **Credit the kid(s) who
  asked for the game** with a `Co-Authored-By` trailer — use a first name or
  nickname / initial only (kid privacy, never full names) and a synthesized email,
  e.g. `Co-Authored-By: Ada R. <ada@familygames.local>`. Do **not** add an
  AI/Claude co-author trailer.

## Definition of a good requirement
Testable + implementable: has explicit acceptance criteria written as
Given/When/Then that a headless test can check, a target age/grade, a measurable
learning objective, and named data/content sources (public-domain only for
bundled/served text).
