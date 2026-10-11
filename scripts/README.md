# Scripts

**Every script of this repository lives in this folder** — the entry point of `npm run migrate`,
the command that builds a local demo database and the database backup. The repository root
holds only configuration (`package.json`, `nodemon.json`, `.gitignore`, the README and the licence).
A new script goes here from the start and runs from here (`node scripts/<name>.js`, or an `npm run` entry
that points at `scripts/`); `test/repoLayout.test.js` fails if a script appears in the root or an
`npm run` entry points at a script outside `scripts/` and `src/`.

Run scripts from the repository root: they read `.env` from the working directory.

| Script | What it does |
|---|---|
| `migrate.js` | `npm run migrate`: the migrations in order, stops at the first error (exit code 1) |
| `migrate:one` → `run-migration.js` | `npm run migrate:one -- <name>`: ONE named migration from an allow-list |
| `demo-database.js` (+ `demo/`) | `npm run demo-db`: structure, taxonomy, badges and an invented demo world (people, teams, roles, applications, awards, chat, notifications) for a NEW LOCAL database; `-- --empty` leaves out the people. Refuses any database that is not local and empty. Writes only invented data from this repository |
| `import-tag-translations.js` | `npm run import:tag-translations`: imports the translated tag names (a dry run unless `--apply`) |
| `backup-db.sh`, `install-backup-agent.sh` | Database backups, below |

The schema changes that used to have a SQL script here (columns, indexes, constraints) are part of the
database as it is now; `src/database/migrations/` holds the incremental steps for existing databases.

## Backups — `backup-db.sh`

```bash
npm run backup           # create a backup now (do this before risky migrations)
npm run backup:status    # list existing backups and the age of the newest
npm run backup:open      # reveal the backup folder in Finder
npm run backup:install   # install/refresh the launchd agent, then verify it
npm run backup:uninstall # remove the agent (existing backups are kept)
```

A **launchd agent runs the backup three times a day (10:00, 14:00, 17:00)**, catching up after boot if a
run was missed. Dumps go to `~/LomirBackups` (override with `LOMIR_BACKUP_DIR`),
are kept for 30 days, and are verified with `pg_restore --list` before the
script reports success. Requires `brew install postgresql@17`.

**The agent runs from `~/.lomir/backup-db.sh`, not from this repo** — macOS
denies background agents any access to `~/Library/CloudStorage` (OneDrive), so
pointing launchd at the repo fails silently. **Re-run `npm run backup:install`
after editing `backup-db.sh` or rotating the database password**, or the agent
keeps using the old copy. Details: `install-backup-agent.sh` and the runbook.

**The storage location is a safety decision, not a preference.** A dump contains
every user's email, password hash, private messages and location, so the script
**refuses** to write anywhere inside this repository (public on GitHub) or into
any cloud-synced folder — `~/Library/CloudStorage` (OneDrive, Google Drive, Box,
Dropbox), `~/Library/Mobile Documents` (iCloud Drive), `~/Dropbox`,
`~/Google Drive`. Check a path without writing anything:

```bash
LOMIR_BACKUP_DIR=<path> ./scripts/backup-db.sh --check-dir
```

**Both operators run this on their own machine** — two laptops mean a period
with one switched off is still covered. Requirements before installing on a
machine: full-disk encryption on, and that machine legitimately holds the
production `DATABASE_URL` already. See runbook §5.

Neon's own PITR and snapshot branches are the first line of defence for everyday
mistakes; this script exists for the case where Neon itself is unavailable.

**Restore procedure and full reasoning:**
`lomir-docs-internal/BACKUP_RESTORE_RUNBOOK.md`.
