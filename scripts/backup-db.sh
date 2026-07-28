#!/usr/bin/env bash
#
# Creates a compressed, self-contained backup of the Lomir production database.
#
# This is the OFF-PROVIDER leg of the backup strategy. Neon's own point-in-time
# recovery and snapshot branches are the first line of defence and cover the
# likely failure modes (bad migration, wrong UPDATE, destructive test). This
# script covers the one thing they cannot: losing access to Neon itself.
#
# Full context, restore procedure and the reasoning behind the storage location:
#   lomir-docs-internal/BACKUP_RESTORE_RUNBOOK.md
#
# Usage:
#   npm run backup                 # create a backup
#   npm run backup:status          # show existing backups and their age
#   ./scripts/backup-db.sh --status
#
# Configuration (environment variables, all optional):
#   LOMIR_BACKUP_DIR       target directory (default: $HOME/LomirBackups)
#   LOMIR_BACKUP_KEEP_DAYS how long to keep old dumps (default: 30)
#   DATABASE_URL           read from the repo's .env when not already set
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${LOMIR_BACKUP_DIR:-$HOME/LomirBackups}"
KEEP_DAYS="${LOMIR_BACKUP_KEEP_DAYS:-30}"
STALE_AFTER_DAYS=30
AGENT_CONFIG="$HOME/.lomir/backup.env"

# This script runs from two places, and the difference matters.
#
#   1. From the repo, invoked by hand as `npm run backup`.
#   2. From ~/.lomir, invoked by the launchd agent (see
#      scripts/install-backup-agent.sh).
#
# Case 2 exists because the repo lives inside ~/Library/CloudStorage (OneDrive),
# and macOS denies background agents *any* access there — verified 2026-07-28:
# a launchd agent could not list the repo directory, read .env, or even read
# this script (exit 126, "Operation not permitted"). Granting the access would
# mean giving /bin/bash Full Disk Access, which is far too broad a permission
# to hand out for a backup job. So the agent runs from a copy outside OneDrive
# and never touches the repo at runtime.
#
# IN_REPO tells the two apart: only a real checkout has package.json one level
# up. It must not be assumed, because when the installed copy sits in
# $HOME/.lomir, REPO_ROOT resolves to $HOME — and the repo guard below would
# then reject the perfectly good default backup directory underneath it.
IN_REPO=false
[ -f "$REPO_ROOT/package.json" ] && IN_REPO=true

# --- helpers -----------------------------------------------------------------

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

# Age of a file in whole days. macOS stat, not GNU stat.
file_age_days() {
  local mtime now
  mtime="$(stat -f %m "$1")"
  now="$(date +%s)"
  echo $(((now - mtime) / 86400))
}

report_existing_backups() {
  local newest age count
  count="$(find "$BACKUP_DIR" -maxdepth 1 -name 'lomir-*.dump' -type f 2>/dev/null | wc -l | tr -d ' ')"

  if [ "$count" -eq 0 ]; then
    printf 'No backups in %s yet.\n' "$BACKUP_DIR"
    return
  fi

  printf 'Backups in %s (%s total):\n\n' "$BACKUP_DIR" "$count"
  # Newest last, so the most recent line is closest to the summary below.
  find "$BACKUP_DIR" -maxdepth 1 -name 'lomir-*.dump' -type f -print0 |
    xargs -0 ls -lht |
    awk '{printf "  %-7s %s %s %s  %s\n", $5, $6, $7, $8, $9}' |
    tail -r

  newest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'lomir-*.dump' -type f -print0 |
    xargs -0 ls -t | head -1)"
  age="$(file_age_days "$newest")"

  printf '\nNewest backup is %s day(s) old.\n' "$age"
  if [ "$age" -ge "$STALE_AFTER_DAYS" ]; then
    printf '\n  WARNING: that is older than %s days. Run: npm run backup\n' "$STALE_AFTER_DAYS"
  fi
}

# --- --status short-circuit --------------------------------------------------

if [ "${1:-}" = "--status" ]; then
  report_existing_backups
  exit 0
fi

# --- guard the storage location ----------------------------------------------
#
# The location is a deliberate decision, not a default: a dump of this database
# contains every user's email, password hash, private messages and location.
# Two places it must never land, both of which would leak it:
#
#   - inside the repo, which is PUBLIC on GitHub. Git itself does not follow
#     symlinks and would only ever commit a link path, but a plain file could
#     be committed by a stray `git add -A`, and a commit to a public repo is
#     irreversible (history, forks, caches).
#   - inside OneDrive, which syncs regardless of git and regardless of
#     .gitignore. Microsoft is not in the project's DPA register.
#
# Both are cheap to detect, so the script refuses rather than trusting the
# operator to remember.

# Every cloud-sync location known on macOS, not just OneDrive. This machine's
# repo happens to live in CloudStorage, but the script also runs on a second
# operator's laptop whose setup we do not know — an unguarded iCloud or Dropbox
# folder would ship the whole database to a provider nobody vetted.
#
#   ~/Library/CloudStorage/   OneDrive, Google Drive, Box, current Dropbox
#   ~/Library/Mobile Documents/  iCloud Drive (NOT under CloudStorage)
#   ~/Dropbox, ~/Google Drive    legacy clients that still use home-level folders
SYNC_HINT="Backups contain every user's email, password hash, private messages
       and location. They must not be synced to a third party.
       Use a local path such as \$HOME/LomirBackups."

case "$BACKUP_DIR" in
*/Library/CloudStorage/*)
  die "refusing to write to '$BACKUP_DIR': that path is inside OneDrive/CloudStorage.
       $SYNC_HINT"
  ;;
*/Library/Mobile\ Documents/*)
  die "refusing to write to '$BACKUP_DIR': that path is inside iCloud Drive.
       $SYNC_HINT"
  ;;
"$HOME"/Dropbox | "$HOME"/Dropbox/* | *"/Dropbox ("*)
  die "refusing to write to '$BACKUP_DIR': that path is inside Dropbox.
       $SYNC_HINT"
  ;;
"$HOME"/Google\ Drive | "$HOME"/Google\ Drive/*)
  die "refusing to write to '$BACKUP_DIR': that path is inside Google Drive.
       $SYNC_HINT"
  ;;
esac

if [ "$IN_REPO" = true ]; then
  case "$BACKUP_DIR" in
  "$REPO_ROOT" | "$REPO_ROOT"/*)
    die "refusing to write to '$BACKUP_DIR': that path is inside the repository,
       which is public on GitHub. Use a local path such as \$HOME/LomirBackups."
    ;;
  esac
fi

# The installer validates the target before creating anything, by calling this
# script rather than repeating the patterns above — one source of truth.
if [ "${1:-}" = "--check-dir" ]; then
  printf 'Backup directory is safe: %s\n' "$BACKUP_DIR"
  exit 0
fi

# --- resolve the connection string -------------------------------------------

# Resolution order: environment, then the agent's own config outside OneDrive,
# then the repo .env. The agent copy can only ever reach the second.
read_database_url_from() {
  grep -E '^DATABASE_URL=' "$1" | head -1 | cut -d= -f2- | tr -d '"'"'"'' | sed 's/[[:space:]]*$//'
}

if [ -z "${DATABASE_URL:-}" ] && [ -f "$AGENT_CONFIG" ]; then
  DATABASE_URL="$(read_database_url_from "$AGENT_CONFIG")"
fi

if [ -z "${DATABASE_URL:-}" ] && [ "$IN_REPO" = true ] && [ -f "$REPO_ROOT/.env" ]; then
  DATABASE_URL="$(read_database_url_from "$REPO_ROOT/.env")"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  die "no DATABASE_URL found. Looked in: the environment, $AGENT_CONFIG$([ "$IN_REPO" = true ] && echo ", $REPO_ROOT/.env").
       If this ran as the launchd agent, re-run 'npm run backup:install' from the repo."
fi

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found. Install it with: brew install postgresql@17"
command -v pg_restore >/dev/null 2>&1 || die "pg_restore not found. Install it with: brew install postgresql@17"

# --- create the backup -------------------------------------------------------

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Seconds matter: with minute granularity, two runs in the same minute — a
# manual `npm run backup` and the launchd agent firing right after it, which is
# exactly what the installer does — silently overwrite each other.
STAMP="$(date +%Y-%m-%d-%H%M%S)"
TARGET="$BACKUP_DIR/lomir-$STAMP.dump"

printf 'Backing up to %s\n' "$TARGET"

# -Fc is the custom format: compressed, and pg_restore can filter it per table
# on the way back in. --no-owner/--no-privileges keep the dump restorable into
# a database whose role is not neondb_owner (a Neon branch, or local Postgres).
if ! pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$TARGET"; then
  rm -f "$TARGET"
  die "pg_dump failed. No backup was written."
fi

# Personal data: readable by the owner only.
chmod 600 "$TARGET"

# Verify the archive is actually readable rather than trusting the exit code.
# pg_restore --list parses the whole table of contents, so a truncated or
# corrupt dump fails here instead of on the day it is needed.
if ! pg_restore --list "$TARGET" >/dev/null 2>&1; then
  rm -f "$TARGET"
  die "the dump was written but pg_restore could not read it. It has been deleted."
fi

TABLES="$(pg_restore --list "$TARGET" | grep -c 'TABLE DATA' || true)"
SIZE="$(du -h "$TARGET" | cut -f1 | tr -d ' ')"

printf 'OK: %s, %s tables with data, archive verified.\n' "$SIZE" "$TABLES"

# --- prune old backups -------------------------------------------------------
#
# Retention is a privacy requirement, not just housekeeping: without it, users
# who deleted their account keep living in the backups indefinitely. The window
# is recorded in lomir-compliance (RECORDS_OF_PROCESSING / TOM).

PRUNED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'lomir-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
if [ "$PRUNED" -gt 0 ]; then
  printf 'Pruned %s backup(s) older than %s days.\n' "$PRUNED" "$KEEP_DAYS"
fi

printf '\n'
report_existing_backups
