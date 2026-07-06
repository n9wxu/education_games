# Design — Skate 'n' Add  (base `/skate`, from request #1, by Veronica)

Fits the Family Games collection per `.claude/house-rules.md`.

## Module
`games/skate/index.js` → `createGame({ base:'/skate', io })` returning
`{ router, io, getLive, broadcast, kickPlayer }`. Registered in `server.js` GAMES.
Own Socket.IO at `/skate/socket.io`. Client under `games/skate/public/`, all URLs
prefixed `/skate`.

## Gameplay (client-authoritative; server persists + relays)
- A single-digit addition problem `a + b` (a,b ∈ 0..9, sum ≤ 18) shows at top.
- Several (4) numbered **stars** drift across a roller rink; exactly one shows the
  correct sum, others are plausible wrong sums. Drift speed set by a **speed dial**
  (1–5). The player moves a **skater** (pointer / touch / arrow keys) into a star.
  - correct → **QUACK** (WebAudio, code-generated), +1, new problem + stars, record correct.
  - wrong → gentle bump, no point, star fades, *problem stays* so they retry (no penalty).
- Low-pressure: no lives / game-over; continuous practice; accuracy tracked.

## Multiplayer (observe-only + optional cooperative — non-disruption guaranteed)
- Each player generates their **own** problem and stars locally → nobody can touch
  another child's stars or answers. Learning state is per-player only.
- Peers are relayed via socket: `join`, `pos` (skater x,y + name/color), `peerLeft`.
  You see other skaters gliding on the rink; you cannot interact with them.
- **Team score**: a toggle opts a player into a shared, **additive-only** team tally
  (`teamPoint` on each correct grab). It can only go up and never forces or blocks
  another player — safe by construction.

## Database (`shared/db.js`, self-initializing, `skate_*`)
- `skate_stats(player_id PK, correct, incorrect, best_streak, games, updated_at)`.
- `skate_fact_stats(player_id, a, b, correct, incorrect, PK(player_id,a,b))` — per-fact
  accuracy for the teacher to see weak facts.
- Helpers + cleanup added to `deletePlayer`.

## Teacher
`portal/teacher.js` + a **Skate 'n' Add** tab in `portal/teacher.html`: per-student
correct/incorrect, accuracy, best streak, and weakest addition facts.

## Selector
Card `🛼 Skate 'n' Add` in `portal/public/index.html`.

## Traceability (criterion → where proven)
1. one correct star among ≥3 → client star generation; test: server has no say, assert generation function via exposed `/skate/api/probe` seldom; **verify in client review** + unit check of distractor logic.
2. QUACK + point on correct → socket `grab {correct:true}` increments stats; test asserts DB `correct` rises.
3. wrong → no point, retry → `grab {correct:false}` increments `incorrect`, not `correct`.
4. speed dial changes drift → client-only; **human/canvas review**.
5. see peers, can't touch their stars → two socket clients: peer positions relayed; assert no message can alter another's score/stars (stats only ever come from a player's own socket).
6. team toggle → shared additive score → `team` event; test: teammate correct raises team score; toggle off keeps own.
7. stays single-digit → problem generator bounds; unit-checkable.

Human-only (canvas/feel): skater control, star drift feel, QUACK sound, art.
