#!/usr/bin/env bash
#
# Family Games installer — sets up a self-updating systemd service on Linux.
#
#   sudo ./install.sh
#
# Environment overrides:
#   REPO_URL         git repo to install/self-update from
#                    (default: https://github.com/n9wxu/education_games.git)
#   INSTALL_DIR      where to install         (default: /opt/education-games)
#   PORT             port to serve on         (default: 3000)
#   TEACHER_PASSWORD teacher dashboard password (default: teacher)
#   SERVICE_USER     user to run the service  (default: root)
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/n9wxu/education_games.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/education-games}"
PORT="${PORT:-3000}"
TEACHER_PASSWORD="${TEACHER_PASSWORD:-teacher}"
SERVICE_USER="${SERVICE_USER:-root}"
SERVICE="education-games"
DB_PATH="$INSTALL_DIR/data/games.db"

if [[ $EUID -ne 0 ]]; then echo "Please run as root (sudo ./install.sh)"; exit 1; fi
for c in node npm git; do command -v "$c" >/dev/null || { echo "Missing required command: $c"; exit 1; }; done

echo "==> Installing Family Games to $INSTALL_DIR (from $REPO_URL)"

# ── Get the code as a git checkout (required for self-update) ──────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "==> Existing checkout found — updating"
  git -C "$INSTALL_DIR" fetch --all --quiet
  git -C "$INSTALL_DIR" reset --hard origin/HEAD --quiet 2>/dev/null || git -C "$INSTALL_DIR" pull --ff-only
else
  if git ls-remote "$REPO_URL" &>/dev/null; then
    echo "==> Cloning repository"
    rm -rf "$INSTALL_DIR"
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  else
    # Offline / no remote access: install from this unpacked tarball and wire up
    # git so future self-updates work once the machine can reach the repo.
    echo "==> Repo unreachable — installing from local files ($PWD)"
    SRC="$(cd "$(dirname "$0")" && pwd)"
    mkdir -p "$INSTALL_DIR"
    tar -C "$SRC" --exclude=.git --exclude=node_modules --exclude=data -cf - . | tar -C "$INSTALL_DIR" -xf -
    git -C "$INSTALL_DIR" init --quiet
    git -C "$INSTALL_DIR" remote add origin "$REPO_URL" 2>/dev/null || true
  fi
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
echo "==> Installing npm dependencies"
( cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund )

# ── Retire the old per-game services BEFORE migrating, so the DB is quiescent ─
# Disable unconditionally; disabling a non-existent unit is a harmless no-op.
for old in math-gator gator-math spelling-game spelling-sniper; do
  if systemctl cat "$old.service" >/dev/null 2>&1; then
    echo "==> Disabling old service: $old"
    systemctl disable --now "$old.service" >/dev/null 2>&1 || true
  fi
done

# ── Migrate an existing single-game database, if present ───────────────────────
mkdir -p "$INSTALL_DIR/data"
if [[ ! -f "$DB_PATH" && -f /opt/gator-math/gatormath.db ]]; then
  echo "==> Migrating existing database from /opt/gator-math/gatormath.db"
  # Fold any WAL contents into the main file using the bundled sqlite (node is
  # always present here; the sqlite3 CLI may not be), then copy the .db.
  node -e "try{const d=require('$INSTALL_DIR/node_modules/better-sqlite3')('/opt/gator-math/gatormath.db');d.pragma('wal_checkpoint(TRUNCATE)');d.close();}catch(e){}" 2>/dev/null || true
  cp /opt/gator-math/gatormath.db "$DB_PATH"
  # Belt-and-suspenders: bring the WAL/SHM along if the checkpoint couldn't run.
  [[ -f /opt/gator-math/gatormath.db-wal ]] && cp /opt/gator-math/gatormath.db-wal "$DB_PATH-wal" || true
  [[ -f /opt/gator-math/gatormath.db-shm ]] && cp /opt/gator-math/gatormath.db-shm "$DB_PATH-shm" || true
fi
chown -R "$SERVICE_USER" "$INSTALL_DIR/data" 2>/dev/null || true

# ── systemd service ───────────────────────────────────────────────────────────
echo "==> Writing systemd unit /etc/systemd/system/$SERVICE.service"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Family Games (Math Gator, Spelling Invaders, Spelling Sniper)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
Environment=PORT=$PORT
Environment=TEACHER_PASSWORD=$TEACHER_PASSWORD
Environment=GAMES_DB_PATH=$DB_PATH
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# ── Optional daily self-update timer ──────────────────────────────────────────
cat > "/etc/systemd/system/$SERVICE-update.service" <<UNIT
[Unit]
Description=Update Family Games from git and restart

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/update.sh
UNIT
cat > "/etc/systemd/system/$SERVICE-update.timer" <<UNIT
[Unit]
Description=Daily Family Games self-update

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

echo "==> Enabling and starting $SERVICE"
systemctl daemon-reload
systemctl enable --now "$SERVICE.service"
systemctl enable --now "$SERVICE-update.timer"

echo ""
echo "✅ Family Games installed."
echo "   URL:      http://$(hostname -f 2>/dev/null || hostname):$PORT/"
echo "   Teacher:  http://$(hostname):$PORT/teacher  (password: $TEACHER_PASSWORD)"
echo "   Update:   sudo $INSTALL_DIR/update.sh   (also runs daily at 04:30)"
