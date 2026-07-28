#!/usr/bin/env bash
#
# Installs (or refreshes) the launchd agent that runs the database backup daily.
#
#   npm run backup:install     install / update the agent
#   npm run backup:uninstall   remove it again
#
# WHY THIS EXISTS AT ALL
#
# The obvious approach — point launchd straight at scripts/backup-db.sh in the
# repo — does not work, and fails *silently* in the worst way: the job reports
# an error to a log nobody reads while you believe backups are running.
#
# The repo lives inside ~/Library/CloudStorage (OneDrive). macOS denies
# background agents any access to that location. Measured 2026-07-28 with a
# probe agent: listing the repo directory, reading .env and even reading the
# backup script itself were all refused ("Operation not permitted", exit 126).
# Only a Full Disk Access grant to /bin/bash would lift it, which would hand
# every shell script on the machine full access — not an acceptable trade for
# a backup job.
#
# So the agent gets its own copy of everything it needs, outside OneDrive:
#
#   ~/.lomir/backup-db.sh   copy of the repo script
#   ~/.lomir/backup.env     DATABASE_URL only, chmod 600
#
# Re-run this script after changing backup-db.sh or rotating the database
# credentials — the copy does not update itself. That duplication is the price
# of keeping the repo in OneDrive; moving the repos out would remove the need
# for this file entirely (and would also fix the known ETIMEDOUT build stalls).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="$HOME/.lomir"
AGENT_SCRIPT="$INSTALL_DIR/backup-db.sh"
AGENT_CONFIG="$INSTALL_DIR/backup.env"
LABEL="com.lomir.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BACKUP_DIR="${LOMIR_BACKUP_DIR:-$HOME/LomirBackups}"
HOUR="${LOMIR_BACKUP_HOUR:-10}"

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

# --- uninstall ---------------------------------------------------------------

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$INSTALL_DIR"
  printf 'Removed the launchd agent and %s.\n' "$INSTALL_DIR"
  printf 'Existing backups in %s were kept.\n' "$BACKUP_DIR"
  exit 0
fi

# --- checks ------------------------------------------------------------------

[ -f "$REPO_ROOT/scripts/backup-db.sh" ] || die "scripts/backup-db.sh not found next to this script"
[ -f "$REPO_ROOT/.env" ] || die "no .env at $REPO_ROOT - cannot read DATABASE_URL"
command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found. Install it with: brew install postgresql@17"

DB_URL="$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | sed 's/[[:space:]]*$//')"
[ -n "$DB_URL" ] || die "DATABASE_URL is empty or missing in $REPO_ROOT/.env"

# pg_dump must be on the agent's PATH; launchd jobs inherit no login shell.
BASE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PG_BIN="$(dirname "$(command -v pg_dump)")"
case ":$BASE_PATH:" in
*":$PG_BIN:"*) AGENT_PATH="$BASE_PATH" ;;
*) AGENT_PATH="$PG_BIN:$BASE_PATH" ;;
esac

# --- provision the runtime copy ----------------------------------------------

mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"

cp "$REPO_ROOT/scripts/backup-db.sh" "$AGENT_SCRIPT"
chmod 700 "$AGENT_SCRIPT"

# A second copy of the credential now exists outside the repo. Keep it readable
# by the owner only; FileVault covers it at rest.
umask 077
printf 'DATABASE_URL=%s\n' "$DB_URL" >"$AGENT_CONFIG"
chmod 600 "$AGENT_CONFIG"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# --- write and load the agent ------------------------------------------------

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$AGENT_SCRIPT</string>
  </array>

  <!-- launchd jobs inherit no login shell, so pg_dump must be given explicitly. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$AGENT_PATH</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>LOMIR_BACKUP_DIR</key>
    <string>$BACKUP_DIR</string>
  </dict>

  <!-- Daily. Unlike cron, launchd remembers a missed occurrence and runs the
       job once shortly after the next boot or wake, coalescing several missed
       runs into one. A laptop that was off for weeks backs up on next start. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>0</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>$BACKUP_DIR/backup.log</string>
  <key>StandardErrorPath</key>
  <string>$BACKUP_DIR/backup.log</string>
</dict>
</plist>
PLIST_EOF

chmod 644 "$PLIST"
plutil -lint "$PLIST" >/dev/null || die "the generated plist is malformed: $PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" || die "launchctl bootstrap failed for $PLIST"

# --- prove it actually runs --------------------------------------------------
#
# An installed-but-broken backup job is worse than none, because it creates
# false confidence. So trigger it once and require a new dump to appear.

printf 'Agent installed. Verifying with a real run...\n\n'

# Detect the new dump by modification time against a marker, not by counting
# files: a run that lands in the same second as an earlier one reuses the
# filename, so the count can stay flat even though the agent worked perfectly.
MARKER="$INSTALL_DIR/.verify-marker"
touch "$MARKER"
sleep 1
: >"$BACKUP_DIR/backup.log"

launchctl kickstart -p "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

FRESH=0
for _ in $(seq 1 30); do
  sleep 1
  FRESH="$(find "$BACKUP_DIR" -maxdepth 1 -name 'lomir-*.dump' -type f -newer "$MARKER" | wc -l | tr -d ' ')"
  [ "$FRESH" -gt 0 ] && break
done
rm -f "$MARKER"

if [ "$FRESH" -gt 0 ]; then
  cat "$BACKUP_DIR/backup.log"
  printf '\nVerified: the agent produced a backup. It will run daily at %s:00.\n' "$HOUR"
  printf 'Log: %s\n' "$BACKUP_DIR/backup.log"
else
  printf 'The agent did NOT produce a backup. Log follows:\n\n'
  cat "$BACKUP_DIR/backup.log" 2>/dev/null || printf '(log is empty)\n'
  printf '\nStatus: %s\n' "$(launchctl list "$LABEL" 2>/dev/null | grep LastExitStatus || echo unknown)"
  die "installation is not working - do not rely on it until this is fixed."
fi
