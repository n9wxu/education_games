# specs/ — game-factory artifact contract

Each new game gets a working folder `specs/<slug>/`. Agents hand off by reading and
writing these files (the orchestrator, `/new-game`, routes between them). See
`.claude/house-rules.md` for the product/architecture rules every artifact must
respect.

## Files (in pipeline order)
| File | Written by | Purpose |
|------|------------|---------|
| `research.md` | educational-researcher | Age-appropriate objectives, mechanics, accessibility, public-domain sources |
| `cheat-analysis.md` | gameplay-analyzer | Cheat paths (mash/spam/brute-force/over-shoot) → fixes + cheat-fails acceptance criteria so scoring requires the skill |
| `requirements.md` | requirements-analyst | Testable requirements incl. **Requested by**, learning objective, **multiplayer model** + no-disruption guarantee, **scoring integrity** (anti-cheat), acceptance criteria (Given/When/Then) |
| `design-gaps.md` | game-designer | Missing/ambiguous requirements bounced back (loopback) |
| `design.md` | game-designer | Design compatible with the collection + traceability (criterion → code → test) |
| `test-plan.md` | test-engineer | Each acceptance criterion → assertion |
| `impl-status.md` | game-implementer | Readiness signal to the test-engineer |
| `test-results.md` | test-engineer | Overall result + failure detail |
| `postmortem-<agent>.md` | every agent | Per-agent retrospective |
| `retro.md` | retrospective-facilitator | Synthesis + what was changed in the agents |

## Status file formats
`impl-status.md` — first line is a status token:
```
READY
<one-line note: what's implemented / caveats / commit-ish>
```
(Use `WIP` while still building.)

`test-results.md` — first line is the verdict, then detail:
```
PASS
<summary; note anything only a human can verify (canvas/feel)>
```
or
```
FAIL
- <criterion/endpoint/event>: expected <x>, got <y>  (repro: <cmd>)
```

## Post-mortem template (`postmortem-<agent>.md`)
```
# Post-mortem — <agent> — <slug>
- What I did well:
- Friction (with the user / the system / other agents):
- Missing context or unclear handoffs:
- Concrete change that would make the next run faster/smoother:
- Time spent (rough):
```

The retrospective-facilitator reads all post-mortems and edits the agent
definitions / command / house-rules so the next run is smoother. North star:
**kid idea → playing on the real server in under an hour.**
