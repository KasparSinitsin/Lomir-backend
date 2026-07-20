# Lomir — User Account Deletion: Complete Specification

## Overview

This document captures every decision made for implementing account deletion in Lomir. It serves as the single reference for backend and frontend implementation.

---

## Pre-Deletion Flow

### Step 1: Password Confirmation
- User clicks "Delete Account" in Settings
- Modal requires **password entry** before proceeding
- Backend verifies password against `password_hash` before returning the impact summary

### Step 2: Impact Summary (new endpoint)
- Backend calculates and returns a JSON summary of what will happen:
  - Teams where ownership will be transferred (with auto-selected successors)
  - Teams that will be deleted (sole-owner teams)
  - Roles that will be reopened
  - Counts: badge awards given, messages, team memberships
- User sees the summary in the modal with the option to **override ownership transfer targets**

### Step 3: Confirm & Execute
- User confirms → backend executes full deletion in a single transaction
- On success: logout, redirect to home
- No grace period — deletion is instant and irreversible
- No confirmation email sent

---

## Scenario-by-Scenario Specification

### 1. Badges the User RECEIVED
| Item | Action |
|------|--------|
| `badge_awards` where `awarded_to_user_id = userId` | **DELETE** |
| `user_badges` where `user_id = userId` | **DELETE** |

User's own badge collection is removed entirely.

### 2. Badges the User AWARDED to Others
| Item | Action |
|------|--------|
| `badge_awards.awarded_by_user_id` | **SET NULL** |
| `user_badges.awarded_by` | **SET NULL** |

Recipients keep their badges and credits intact. Frontend displays **"Former Lomir User"** with a **grey silhouette avatar** wherever the awarder's name/avatar would appear. No credit recalculation needed.

### 3. Teams — Sole Owner (Only Member)
| Item | Action |
|------|--------|
| The team itself | **HARD DELETE** |
| `team_tags` for the team | **DELETE** (cascades) |
| `team_members` for the team | **DELETE** (cascades) |
| `team_vacant_roles` for the team | **DELETE** (cascades) |
| `team_vacant_role_tags` for those roles | **DELETE** (cascades) |
| `team_vacant_role_badges` for those roles | **DELETE** (cascades) |
| `team_applications` for the team | **DELETE** |
| `team_invitations` for the team | **DELETE** |
| `messages` with `team_id` for the team | **DELETE** |

**Before deleting:** Copy team name into `badge_awards.custom_team_name` (and SET NULL on `badge_awards.team_id`) for any badge awards that reference this team. This preserves the team name on badges without a clickable link.

**Notifications to send before deletion:**
- Notify **pending applicants** that the team has been dissolved
- Notify **pending invitees** (team and role invitations) that the team has been dissolved

**Pre-deletion summary** shows these teams with a clear message: *"This team will be permanently deleted."*

### 4. Teams — Owner with Other Members (Ownership Transfer)
| Item | Action |
|------|--------|
| `teams.owner_id` | **UPDATE** to successor |
| `team_members` role of successor | **UPDATE** to `'owner'` |
| `team_members` row of deleted user | **DELETE** |

**Successor selection cascade:**
1. User's explicit choice (from pre-deletion summary override)
2. Longest-serving **admin** (by `joined_at`)
3. Longest-serving **member** (by `joined_at`)

**Notifications:**
- Successor receives ownership transfer notification
- Team chat receives system message (see §12)

### 5. Teams — Regular Member (Not Owner)
| Item | Action |
|------|--------|
| `team_members` row | **DELETE** |

Team chat receives system message: `"🚪 [Name] has left Lomir."` (uses the user's real name one final time).

### 6. Roles the User FILLED
| Item | Action |
|------|--------|
| `team_vacant_roles.status` | **UPDATE** to `'open'` |
| `team_vacant_roles.filled_by` | **SET NULL** |

**Timing:** Execute after removing user from `team_members` but before deleting the user row (so the user's name is still available for notifications).

**Notifications:**
- Team **owner and admins** receive a dedicated notification: *"The role [Role Name] is now open again."*
- Team chat receives a system message: `"🔓 The role [Role Name] is now open again."`

### 7. Roles the User CREATED
| Item | Action |
|------|--------|
| `team_vacant_roles.created_by` | **SET NULL** |

Role definitions persist. Only the "created by" attribution is lost.

### 8. User's Team Applications
| Item | Action |
|------|--------|
| `team_applications` where `applicant_id = userId` | **DELETE** (all statuses) |

### 9. Applications the User Reviewed
| Item | Action |
|------|--------|
| `team_applications.reviewed_by` | **SET NULL** |

The approval/rejection decision stands; reviewer attribution is cleared.

### 10. All Invitations Involving the User
| Item | Action |
|------|--------|
| `team_invitations` where `invitee_id = userId` | **DELETE** (all statuses) |
| `team_invitations` where `inviter_id = userId` | **DELETE** (all statuses) |

Both pending and resolved invitations are removed.

### 11. Direct Messages
| Item | Action |
|------|--------|
| `messages` where `sender_id = userId AND team_id IS NULL` | **DELETE** |
| `messages` where `receiver_id = userId AND team_id IS NULL` | **DELETE** |

All DMs involving the user are removed. The other party loses the conversation. ImageKit file attachments in these messages are left alone — existing 60-day expiration handles cleanup.

### 12. Team Chat Messages
| Item | Action |
|------|--------|
| `messages.sender_id` where `sender_id = userId AND team_id IS NOT NULL` | **SET NULL** |
| System messages containing user's name | **REPLACE** name with `"Former Lomir User"` in `content` |

**New departure message** posted to each team: `"🚪 [Real Name] has left Lomir."` — this is the last record of their name.

**Backend query fix required:** `getMessages` must change `JOIN users u ON m.sender_id = u.id` → `LEFT JOIN users u ON m.sender_id = u.id`.

**Frontend display:** Messages with `sender_id = NULL` show **"Former Lomir User"** with a **generic grey silhouette** avatar.

### 13. Notifications FOR the User
| Item | Action |
|------|--------|
| `notifications` where `user_id = userId` | **DELETE** |

### 14. Notifications ABOUT the User
| Item | Action |
|------|--------|
| `notifications.actor_id` where `actor_id = userId` | **SET NULL** |
| `notifications.reference_id` where it points to a now-deleted resource | **SET NULL** |

Notification text (`title`, `message`) already contains the name as a baked-in string, so notifications remain readable. Frontend shows "Former Lomir User" for the actor avatar/link.

### 15. User Tags
| Item | Action |
|------|--------|
| `user_tags` where `user_id = userId` | **DELETE** (CASCADE handles this) |

### 16. Tags Created by the User
| Item | Action |
|------|--------|
| `tags.created_by` where `created_by = userId` | **SET NULL** |

Currently 0 user-created tags exist (all 780 are system tags), but this FK is `NO ACTION` and will block deletion if a user ever creates custom tags. Must be handled in code.

### 17. Messages — deleted_by Column
| Item | Action |
|------|--------|
| `messages.deleted_by` where `deleted_by = userId` | **SET NULL** |

No FK constraint exists on this column, so it won't block deletion, but cleanup prevents orphaned references.

---

## Profile Placeholder

When someone visits a deleted user's profile URL:
- **Show a "This user profile does not exist on Lomir" placeholder page** with subtitle **"This profile is not available"**
- Grey silhouette avatar, no personal information displayed
- This placeholder appears for ANY profile 404 — the backend does not distinguish between "never existed" and "was deleted". This is by design (Option A).

---

## Real-Time Updates (Socket.IO)

On successful deletion, emit events so connected clients update:
- `team:member_left` → to each team the user was in (refreshes member list)
- `notification:new` → to team owners/admins for reopened roles
- `notification:new` → to pending applicants/invitees of dissolved teams
- `conversation:deleted` → to DM partners (removes the conversation from their list)

---

## New API Endpoints

### `POST /api/users/:id/deletion-preview`
- **Auth:** Requires valid token + password verification
- **Returns:** Impact summary JSON (teams to transfer, teams to delete, roles to reopen, counts)

### `DELETE /api/users/:id` (updated)
- **Auth:** Requires valid token + password in request body
- **Body:** `{ password: string, ownershipOverrides?: { teamId: number, successorId: number }[] }`
- **Executes:** Full deletion transaction as specified above
- Service calls use `skipAuthRedirect` on the frontend to prevent a 401 (wrong password) from triggering a global logout.

---

## Frontend Changes Required

1. **Settings.jsx** — Updated delete modal: password input → impact summary → confirm
2. **Message display components** — Handle `sender_id = NULL` → show "Former Lomir User" + grey avatar
3. **AwardCard.jsx / badge components** — Handle `awarded_by = NULL` → show "Former Lomir User"
4. **Profile routes** — New `/profile/:id` public route with `PublicProfile.jsx` component for deleted user placeholder. `UserDetailsModal` also handles 404 inline with 'Former Lomir User' display.
5. **Notification click handlers** — Handle `reference_id = NULL` gracefully (no navigation)
6. **Chat/conversation list** — Handle `conversation:deleted` socket event
7. **Shared utility** — `deletedUser.js` (or similar) with `DELETED_USER_DISPLAY_NAME` constant, `isDeletedUser()` helper, `getDisplayName()` fallback, and `FormerUserAvatar` grey silhouette component.

---

## Database FK Constraint Analysis

Based on the actual constraints in the Neon database:

### Already handled automatically by CASCADE / SET NULL on `DELETE FROM users`:
| Table.Column | Rule | Notes |
|---|---|---|
| `badge_awards.awarded_to_user_id` | CASCADE | Deletes received awards |
| `badge_awards.awarded_by_user_id` | SET NULL | Preserves others' badges |
| `messages.sender_id` | SET NULL | Keeps team messages |
| `messages.receiver_id` | SET NULL | Keeps DMs — but we delete DMs first |
| `notifications.user_id` | CASCADE | Removes user's notifications |
| `notifications.actor_id` | SET NULL | Preserves others' notifications |
| `team_applications.applicant_id` | CASCADE | Removes user's applications |
| `team_invitations.invitee_id` | CASCADE | Removes invitations to user |
| `team_invitations.inviter_id` | CASCADE | Removes invitations from user |
| `team_members.user_id` | CASCADE | Removes memberships — but we transfer ownership first |
| `user_badges.user_id` | CASCADE | Removes user's badge summary |
| `user_tags.user_id` | CASCADE | Removes user's tags |

### 6 blockers — must be resolved BEFORE deleting user row:
| Table.Column | Rule | Action in code |
|---|---|---|
| `teams.owner_id` | NO ACTION | Transfer ownership or delete team first |
| `team_vacant_roles.filled_by` | NO ACTION | SET NULL + reopen role |
| `team_vacant_roles.created_by` | NO ACTION | SET NULL. **Schema change applied:** `ALTER TABLE team_vacant_roles ALTER COLUMN created_by DROP NOT NULL` — the column originally had a NOT NULL constraint that prevented SET NULL. This was dropped in the Neon database. |
| `team_applications.reviewed_by` | NO ACTION | SET NULL |
| `user_badges.awarded_by` | NO ACTION | SET NULL |
| `tags.created_by` | NO ACTION | SET NULL (0 rows currently, future-proofing) |

### No FK but needs cleanup:
| Table.Column | Action |
|---|---|
| `messages.deleted_by` | SET NULL (18 rows, no FK constraint) |

### Critical ordering note:
Since `messages.sender_id/receiver_id` auto-SET-NULL and `team_members.user_id` auto-CASCADEs when the user row is deleted, all custom cleanup (DM deletion, system message rewriting, ownership transfers, role reopening) **must happen before** `DELETE FROM users`.

---

## Transaction Order

The `deleteUser` controller executes all operations in a **single database transaction** in this order:

**Phase A — Gather context (before any mutations):**
1. **Verify password** against stored hash
2. **Fetch user data**: name, avatar URL, team memberships (with roles), owned teams, filled roles

**Phase B — Messages & chat cleanup (while sender_id still identifies the user):**
3. **Delete all DMs** involving the user (`sender_id = userId OR receiver_id = userId` where `team_id IS NULL`)
4. **Post departure messages** to all team chats: `"🚪 [Name] has left Lomir."`
5. **Replace user's name** in existing system messages in team chats with `"Former Lomir User"`

**Phase C — Team ownership (while team_members still exist):**
6. **Handle sole-owner teams:**
   a. Copy team name into `badge_awards.custom_team_name` where `badge_awards.team_id` references the team
   b. Create notifications for pending applicants/invitees about dissolution
   c. Hard delete: team_invitations, team_applications, messages, team_vacant_role_tags, team_vacant_role_badges, team_vacant_roles, team_tags, team_members, then the team itself
7. **Transfer ownership** of multi-member teams (update `teams.owner_id` + `team_members.role`)

**Phase D — Role & reference cleanup (resolve all 6 NO ACTION blockers):**
8. **Reopen filled roles**: `UPDATE team_vacant_roles SET status='open', filled_by=NULL WHERE filled_by=userId`
9. **Create notifications** for all team members about reopened roles
10. **SET NULL on remaining blockers:**
    - `team_vacant_roles.created_by`
    - `team_applications.reviewed_by`
    - `user_badges.awarded_by`
    - `tags.created_by`
11. **SET NULL** on `messages.deleted_by` (no FK, but clean up orphaned refs)
12. **SET NULL** on `notifications.reference_id` for notifications pointing to resources that were deleted in Phase C

**Phase E — Delete user row (CASCADE handles the rest):**
13. **DELETE the user row** — triggers automatic CASCADE/SET NULL for all remaining FKs

**Phase F — Post-transaction cleanup (outside transaction):**
14. **Delete ImageKit avatar** (non-blocking, best-effort)
15. **Emit Socket.IO events**: `team:member_left`, `notification:new`, `conversation:deleted`

---

## Query Fixes Applied

All `JOIN users u ON m.sender_id = u.id` in `messageController.js` changed to `LEFT JOIN` — affects `getMessages` (both legacy and paginated versions) and `getMessageById`. Without this, team messages from deleted users (`sender_id = NULL`) are silently excluded from results.

---

## Data Impact Summary (Current Database)

| Resource | Count | Action | FK handles it? |
|----------|-------|--------|----------------|
| Badge awards (received by user) | Varies | Deleted | ✅ CASCADE |
| Badge awards (given by user) | Up to 188 users affected | SET NULL | ✅ SET NULL |
| User badges (awarded_by) | Up to 186 users affected | SET NULL | ❌ NO ACTION — code required |
| Team memberships | Up to 158 users | Removed | ✅ CASCADE (after ownership transfer) |
| Teams (sole owner) | 3 currently | Hard deleted | ❌ NO ACTION — code required |
| Teams (owner with members) | 74 currently | Ownership transferred | ❌ NO ACTION — code required |
| Filled roles | 13 currently | Reopened | ❌ NO ACTION — code required |
| Roles created_by | 21 users affected | SET NULL | ❌ NO ACTION — code required |
| Tags created_by | 0 currently | SET NULL | ❌ NO ACTION — code required |
| Applications reviewed_by | 41 users affected | SET NULL | ❌ NO ACTION — code required |
| DMs | 1,292 total | Deleted before cascade | ⚠️ SET NULL would fire — must pre-delete |
| Team messages | 1,681 total | Sender nullified | ✅ SET NULL (rewrite names before cascade) |
| Notifications (user's) | Varies | Deleted | ✅ CASCADE |
| Notifications (actor) | 191 users affected | SET NULL | ✅ SET NULL |
| Invitations | 585 total | All involving user deleted | ✅ CASCADE |
| Applications (user's) | Varies | Deleted | ✅ CASCADE |
| Messages deleted_by | 18 rows | SET NULL | ⚠️ No FK — code required |

---

## Implementation Notes

**Status:** Fully implemented and tested (April 2026).

**Schema change applied:** `team_vacant_roles.created_by` changed from NOT NULL to nullable.

**Key files (backend):**
- `src/controllers/userController.js` — `deletionPreview` and `deleteUser` functions
- `src/controllers/messageController.js` — LEFT JOIN fixes
- `src/routes/userRoutes.js` — POST /:id/deletion-preview route
- `test/userController.deleteUser.test.js` — deletion test coverage (41 tests)

**Key files (frontend):**
- `src/pages/Settings.jsx` — multi-step deletion modal
- `src/pages/PublicProfile.jsx` — deleted user profile placeholder
- `src/App.jsx` — /profile/:id route
- `src/services/userService.js` — deletionPreview and updated deleteUser methods
- `src/components/badges/AwardCard.jsx` — Former Lomir User fallback
- Shared deleted user utility and FormerUserAvatar component
- Chat message components — null sender handling
- Notification components — null actor/reference handling
- `UserDetailsModal.jsx` — inline deleted user handling on 404
