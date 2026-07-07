---
description: Run the kid-idea → live-game factory pipeline (interview, research, design, parallel test+build, release, retro). Goal — playing on the real server in under an hour.
argument-hint: [short game idea]
---

You are the **orchestrator** of the Family Games factory. A kid wants a new game:
`$ARGUMENTS`

Read `.claude/house-rules.md` first. You own all user interaction and routing;
the specialized subagents do the work autonomously and hand off through files in a
per-game folder. Keep the whole run under an hour — bias to a small first version.

## Setup
1. Pick a short kebab-case `<slug>` for the game. Create `specs/<slug>/`.
2. Read `specs/README.md` for the artifact contract and status-file formats.

## Pipeline
1. **Requirements.** Spawn `requirements-analyst`. It will hand you a short list of
   interview questions — **you** ask the user (plain, kid/parent-friendly), collect
   answers, and relay them back. When it needs learning research, spawn
   `educational-researcher` and pass `research.md` back to the analyst. Once the
   core mechanic + scoring are sketched, spawn `gameplay-analyzer` and pass its
   `cheat-analysis.md` back so the analyst folds in the anti-cheat fixes/criteria
   (steer the kid to a committing/first-try version if the mechanic is cheatable).
   Present the research-informed draft to the user and iterate until they approve
   `specs/<slug>/requirements.md`. Ensure it captures **Requested by** (for kid
   commit credit), the **multiplayer model** with the no-disruption guarantee, and
   **scoring integrity** (score requires the skill — no mash/spam/brute-force path).
2. **Design.** Spawn `game-designer`. If it writes `design-gaps.md`, route those
   back to `requirements-analyst` (ask the user only if needed), then re-run the
   designer. Loop until `design.md` is complete and every acceptance criterion
   traces to a design element + a planned test.
3. **Build + test in parallel.** Spawn `game-implementer` and `test-engineer`
   together (run at least one in the background). They coordinate via
   `impl-status.md` / `test-results.md`: implementer flips `READY`, test-engineer
   runs and writes `PASS`/`FAIL`, implementer fixes on `FAIL`. Relay between them if
   they stall; keep looping until `test-results.md` is `PASS`.
4. **Release.** Spawn `release-manager` (only on `PASS`): docs, commit crediting the
   kid(s) as `Co-Authored-By`, push, deploy via `update.sh`, verify live, clean up
   test data.
5. **Retro.** Ensure every stage wrote `specs/<slug>/postmortem-*.md`, then spawn
   `retrospective-facilitator` to synthesize `retro.md` and improve the agents.

## Report to the user
The live URL, the commit, who was credited, and exactly what to eyeball by hand
(canvas/feel can't be tested headlessly). If the run can't finish cleanly, say
where it stopped and why, and what you need from the user to continue.
