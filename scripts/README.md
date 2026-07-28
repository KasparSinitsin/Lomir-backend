# Database Scripts

This folder contains SQL scripts for seeding and managing the Lomir database,
plus the database backup script.

## Backups — `backup-db.sh`

```bash
npm run backup           # create a backup now (do this before risky migrations)
npm run backup:status    # list existing backups and the age of the newest
npm run backup:open      # reveal the backup folder in Finder
npm run backup:install   # install/refresh the daily launchd agent, then verify it
npm run backup:uninstall # remove the agent (existing backups are kept)
```

A **launchd agent runs the backup daily at 10:00**, catching up after boot if a
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

---

## SQL scripts

## How to Run Scripts in Neon

### Step 1: Access Neon SQL Editor

1. Go to [Neon Console](https://console.neon.tech/)
2. Log in with your credentials
3. Select the **Lomir** project
4. Click on **SQL Editor** in the left sidebar

### Step 2: Run a Script

1. Open the `.sql` file you want to run
2. Copy the entire contents of the file
3. Paste into the Neon SQL Editor
4. Click **Run** (or press `Cmd/Ctrl + Enter`)

### Step 3: Verify Results

Most scripts include verification queries at the bottom. After running the main script, run the verification queries to confirm the data was inserted correctly.

---

## Available Scripts

### `seed_badge_awards.sql`

**Purpose:** Seeds realistic badge awards across all 30 badges for testing.

**What it does:**
- Clears existing `badge_awards` table
- Resets the ID sequence
- Inserts ~120 badge awards across 30 badges
- Distributes badges to ~25 users with role-appropriate assignments

**When to use:**
- After a fresh database setup
- When badge display needs to be tested
- If badge_awards data becomes corrupted

**Verification:**
After running, check:
- All 30 badges should be used
- ~25 users should have badges
- Credit totals should vary (1-3 per award)

**Example output from verification query:**
```
badges_used: 30
```

### `add_team_application_role_id.sql`

**Purpose:** Adds optional vacant-role linking to team applications.

**What it does:**
- Adds nullable `team_applications.role_id`
- Adds a foreign key to `team_vacant_roles(id)` with `ON DELETE SET NULL`
- Adds an index on `role_id`

**When to use:**
- Before deploying the backend change that accepts `roleId` on team applications
- When upgrading an existing database that already has `team_applications`

---

## Script Categories

| Script | Purpose | Destructive? |
|--------|---------|--------------|
| `seed_badge_awards.sql` | Seed test badge data | Yes - clears badge_awards |

---

## Best Practices

1. **Backup first**: Before running destructive scripts, consider backing up the table
2. **Run in staging first**: Test scripts in a staging environment before production
3. **Check verification queries**: Always run the verification queries after seeding
4. **Document changes**: Update this README when adding new scripts

---

## Troubleshooting

### "Syntax error" when pasting

If you get syntax errors, check for:
- SQL comments with `--` being converted to single `-` (copy-paste issue)
- Missing semicolons at the end of statements
- Extra whitespace or invisible characters

**Solution:** Copy the script to a plain text editor first, then copy from there to Neon.

### "Sequence does not exist" error

The sequence name might differ. Check your actual sequence name:
```sql
SELECT sequence_name FROM information_schema.sequences 
WHERE sequence_name LIKE '%badge_awards%';
```

### "Foreign key violation" error

Make sure the user IDs and badge IDs referenced in the script exist in your database:
```sql
SELECT id FROM users WHERE id IN (86, 87, 88, 89, 90);
SELECT id FROM badges WHERE id BETWEEN 115 AND 144;
```
