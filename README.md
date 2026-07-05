# Family Games

A collection of educational web games for kids, served from a **single port** with a
**shared player database** and a **unified teacher/parent dashboard**.

| Game | Path | What you do |
|------|------|-------------|
| 🐊 **Math Gator** | `/math` | Feed the gator correct answers to +, −, ×, ÷ facts. |
| 👾 **Spelling Invaders** | `/spelling` | Rescue the correctly-spelled words; don't shoot the misspellings. |
| 🎯 **Spelling Sniper** | `/sniper` | Snipe the misspelled words, then type the correct spelling. |
| 🚂 **Typing Train** | `/typing` | Drive a steam train by touch-typing — learn the keys on loop tracks, then type real stories. |

- **One login works everywhere** — accounts and sessions are shared across all three games.
- **One teacher dashboard** at `/teacher` — manage players, math focus facts, spelling
  word lists, and watch live play (protected by a shared password).
- **One SQLite database** (`data/games.db`).

---

## Quick test (no install)

Requires **Node.js 18+**. From an unpacked copy of this project:

```bash
npm install
npm start
```

Then open <http://localhost:3000/>. The database is created automatically at `data/games.db`.

Handy environment variables:

```bash
PORT=8080 TEACHER_PASSWORD=letmein npm start
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | Port to serve on |
| `TEACHER_PASSWORD` | `teacher` | Password for the `/teacher` dashboard |
| `GAMES_DB_PATH` | `./data/games.db` | Location of the SQLite database |

---

## Install on a server (systemd, self-updating)

On a Linux box with **Node.js, npm and git** installed:

```bash
# 1. Download and unpack the release tarball
tar xzf family-games.tar.gz
cd education_games

# 2. Install (creates a systemd service + daily self-update timer)
sudo ./install.sh
```

By default this installs to `/opt/education-games`, serves on port **3000**, and:

- Clones the project from git so it can **self-update**.
- Migrates an existing single-game database from `/opt/gator-math/gatormath.db` if found (no data loss).
- Writes and starts an `education-games.service` systemd unit.
- Disables the older per-game services (`math-gator`, `spelling-game`, `spelling-sniper`, …) if present.
- Installs a timer that self-updates daily at 04:30.

Override any default:

```bash
sudo REPO_URL=https://github.com/n9wxu/education_games.git \
     INSTALL_DIR=/opt/education-games \
     PORT=3000 \
     TEACHER_PASSWORD='choose-a-password' \
     ./install.sh
```

### Managing the service

```bash
systemctl status education-games        # is it running?
journalctl -u education-games -f        # live logs
systemctl restart education-games       # restart
```

### Updating

Self-updates run daily, or trigger one immediately:

```bash
sudo /opt/education-games/update.sh
```

This does `git pull`, reinstalls dependencies, and restarts the service.

---

## How it fits together

```
server.js                 one Express app + HTTP server on ONE port
├── /                      selector menu            (portal/public/index.html)
├── /math      → games/math/                  Math Gator
├── /spelling  → games/spelling-invaders/     Spelling Invaders
├── /sniper    → games/spelling-sniper/       Spelling Sniper
├── /typing    → games/typing-train/          Typing Train
└── /teacher   → portal/teacher.js + teacher.html   unified dashboard

shared/db.js              one self-initializing SQLite schema (accounts + all game stats)
shared/auth.js            shared login/register/session routes (single sign-on)
shared/audio/             tracker music + libopenmpt/chiptune WASM used by the spelling games
data/games.db             the database (created on first run; gitignored)
```

Each game mounts its own Socket.IO instance at `<base>/socket.io`, so the three games
coexist on one port without collisions. Because they all use `shared/db.js`, a session
token issued by any game authenticates the player in every game.

---

## License

MIT — see [LICENSE](LICENSE).
