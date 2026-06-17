# Lomir - Backend

REST API and real-time messaging server for **Lomir**, a team-matching platform that helps people find collaborators based on shared interests, skills, badges, and location.

Built with Node.js, Express, PostgreSQL (Neon), and Socket.IO.

---

## Live Demo

**Try it now:** [lomir-frontend.vercel.app](https://lomir-frontend.vercel.app)

> The backend runs on Render's free tier and enters sleep mode after inactivity. The first request may take 15–30 seconds to wake up — after that, everything responds normally.

| Service  | Platform | URL |
|----------|----------|-----|
| Frontend | Vercel   | [lomir-frontend.vercel.app](https://lomir-frontend.vercel.app) |
| Backend  | Render   | [lomir-backend-knae.onrender.com](https://lomir-backend-knae.onrender.com) |
| Database | Neon     | PostgreSQL (remote) |

### Test Credentials

Contact the project owner for a demo login, or register a new account with a valid email address. Email verification is required, and new profiles stay private until the user changes visibility in settings.

---

## Features

- **Authentication** — JWT-based registration, login, email verification, password reset, and verified email change. The session JWT is delivered as an `httpOnly`, `sameSite` cookie (never in the response body or readable by frontend JavaScript); auth middleware and the Socket.IO handshake read it from the cookie, with the `Authorization: Bearer` header kept as a fallback for API clients. Transactional auth emails are sent through Nodemailer SMTP. Registration protected by Cloudflare Turnstile CAPTCHA (feature-flagged for local dev). Registration requires explicit acceptance of Terms of Service, acknowledgement of the Privacy Policy, and confirmation of minimum age (16+); the version of each legal document is stamped on the user row at sign-up. Changing an account email is double-opt-in: the current-password-protected request stores the new address as `pending_email` with a 24-hour token and sends a verification link to it, and the account email only switches over once the new address confirms — the old address stays active until then. Expired email-change tokens are cleared by the same cleanup pass as password-reset tokens.
- **User Profiles** — CRUD with avatar uploads (ImageKit), interest tags, badge portfolios, and user-controlled public/private visibility. Verified accounts remain private by default until the user opts in to public visibility.
- **User Blocking** — Authenticated users can manage a private blocklist. Block relationships hide profiles and user-search results where requester context is available, suppress team application visibility, disable direct messaging, and exclude blocked users from team chat realtime events where needed.
- **Teams** — Create, join, manage members, assign roles, and archive teams
- **Vacant Roles** — Post open positions on teams with desired tags, badges, and location preferences
- **Matching Engine** — Score users against roles (and vice versa) using weighted tag/badge/distance criteria
- **Search** — Global search across teams, users, and roles with boolean queries, tag/badge/location filtering, proximity sorting, and "Best Match" scoring
- **Chat** — Real-time direct and team group messaging via Socket.IO, including typing indicators, read receipts, message replies (reply-to with sender preview), @mention notifications, and structured system messages for team events (member join/leave/removal, role changes, invitation responses, application decisions, role lifecycle, team deletion)
- **Badge System** — 30 badges across 5 categories; award badges to teammates with reasons and context
- **Notifications** — In-app notifications for invitations, applications, badge awards, messages, @mentions, and role lifecycle events; each notification deep-links to the exact message that triggered it; stale notifications are cleaned up automatically on member removal, role deletion, and team deletion
- **Account Deletion** — Full transactional account deletion with impact preview, automatic team ownership transfer, role reopening, and "Former Lomir User" handling for preserved references
- **Contact Form & Reports** — Public `/api/contact` endpoint with Joi validation, Turnstile CAPTCHA, in-memory file attachments (up to 3 files, 5 MB each, 10 MB total), and SMTP forwarding. Abuse/content reports are persisted in `contact_reports` with a reference ID before email forwarding, so reports are not lost if SMTP delivery fails; reporters also receive an automated acknowledgement-of-receipt email with their reference ID (sent only for `Report content or abuse` submissions, best-effort so a failed receipt never fails the request); unexpected body fields are stripped defensively so multipart attachment fields cannot break validation; rate-limited to 5 submissions/hr
- **Geocoding** — Location enrichment via Nominatim: resolves a full location object (postal code, city, district, state, country, coordinates) from partial input. Built-in postal-code-to-district lookup for Berlin and Frankfurt (200+ mappings) used as a fast offline fallback before the API call. Works with country alone — does not require both postal code and city.
- **Security** — `httpOnly` cookie sessions (JWT not exposed to JavaScript), CSRF origin/referer validation on all state-changing requests, Helmet security headers, request body size cap (1 MB), rate limiting on auth, contact, and geocoding endpoints, credentialed CORS allowlist (applied before body parsing), password policy enforcement, Socket.IO conversation/message authorization, production error message scrubbing

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Database | PostgreSQL (Neon, remote) |
| Real-time | Socket.IO |
| Auth | JSON Web Tokens (jsonwebtoken, bcrypt) |
| Validation | Joi |
| File Uploads | ImageKit + Multer |
| Email | Nodemailer SMTP |
| Scheduling | node-cron |
| CAPTCHA | Cloudflare Turnstile |
| Rate Limiting | express-rate-limit |
| Security Headers | Helmet |

---

## Getting Started

### Prerequisites

- **Node.js** v18+ and npm
- Internet access (database is hosted on Neon — no local PostgreSQL needed)
- Native build tools for `bcrypt`:
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools with C++ workload
  - Linux: `sudo apt install build-essential python3`

### 1. Clone the repo

```bash
git clone https://github.com/KasparSinitsin/Lomir-backend.git
cd Lomir-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env`

Create a `.env` file in the project root:

```env
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require

# Server
PORT=5001
NODE_ENV=development

# JWT Authentication
JWT_SECRET=<your-jwt-secret>
JWT_EXPIRES_IN=7d

# ImageKit (image/file uploads)
IMAGEKIT_PUBLIC_KEY=<your-public-key>
IMAGEKIT_PRIVATE_KEY=<your-private-key>
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<your-id>

# SMTP email (Gmail SMTP in the current deployment)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<smtp-email-address>
SMTP_PASS=<smtp-app-password>

# Frontend URL (for CORS and email links)
CLIENT_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Cloudflare Turnstile (optional for local dev — if unset, CAPTCHA is skipped)
# TURNSTILE_SECRET_KEY=<turnstile-secret-key>
```

> Get the ImageKit and database values from the project owner.

### 4. Run the server

```bash
npm run dev
```

The server starts on `http://localhost:5001` with hot reload via nodemon.

Verify it's running by visiting `http://localhost:5001` — you should see **"Lomir API is running..."**

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with nodemon (hot reload) |
| `npm start` | Start production server |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed the database with initial data |
| `npm test` | Run tests (`node --test`) |

### Test Notes

For search work, run the focused search suite:

```bash
node --test test/searchController.test.js
```

That suite covers pagination, sorting, proximity handling, synthetic/demo-data filtering, match-score enrichment, and team/member exclusion behavior for the active search endpoints.

For contact/report work, run the focused contact suite:

```bash
node --test test/contactController.test.js
```

That suite covers abuse report persistence, reference ID responses, email-forwarding status updates, the reporter acknowledgement-of-receipt email (sent for reports, skipped for ordinary messages, and best-effort on failure), persistence failure handling, and the ordinary contact-message path.

---

## Project Structure

```text
Lomir-backend/
├── src/
│   ├── app.js                  # Express app setup, middleware, route mounting
│   ├── server.js               # HTTP server + Socket.IO setup
│   ├── config/
│   │   ├── database.js         # PostgreSQL connection pool (Neon)
│   │   ├── imagekit.js         # ImageKit client configuration
│   │   └── legalDocuments.js   # Current version constants for Terms, Privacy Policy, and age confirmation
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── teamController.js          # Team create/update/delete + ownership transfer
│   │   ├── teamReadController.js      # Team reads (getTeamById, getMyTeams, lite list)
│   │   ├── teamMembersController.js   # Team member add/remove/role-change
│   │   ├── teamApplicationsController.js # Team join applications + decisions
│   │   ├── teamBadgeController.js     # Team badge awards (member badges, team badge awards)
│   │   ├── invitationController.js
│   │   ├── vacantRoleController.js
│   │   ├── searchController.js
│   │   ├── badgeController.js
│   │   ├── contactController.js       # Contact form: Joi validation with unknown-field stripping,
│   │   │                              #   Turnstile CAPTCHA, report persistence, SMTP forwarding
│   │   ├── messageController.js
│   │   ├── notificationController.js
│   │   └── matchingController.js
│   ├── routes/
│   │   ├── index.js            # Central route registry
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── teamRoutes.js
│   │   ├── searchRoutes.js
│   │   ├── badgeRoutes.js
│   │   ├── contactRoutes.js    # Contact form route with multer (up to 3 attachments)
│   │   ├── messageRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── matchingRoutes.js
│   │   ├── imagekitRoutes.js
│   │   ├── geocodingRoutes.js
│   │   └── api/
│   │       └── tags.js
│   ├── middlewares/
│   │   ├── auth.js             # Reads the session JWT from the httpOnly cookie (Bearer header fallback)
│   │   ├── csrfProtection.js   # Origin/Referer validation on state-changing requests
│   │   ├── rateLimiter.js      # Rate limiting for auth, contact, and geocoding endpoints
│   │   └── uploadMiddleware.js # Multer wrapper for file/image uploads
│   ├── models/
│   │   ├── userModel.js         # User row queries + legal-consent persistence
│   │   ├── teamModel.js
│   │   ├── tagModel.js
│   │   └── contactReportModel.js # Persistent abuse/content report records and email status updates
│   ├── services/
│   │   └── emailService.js     # Nodemailer SMTP transactional email (verification, password reset/changed, email-change, contact forwarding, report receipt)
│   ├── utils/
│   │   ├── booleanSearchParser.js
│   │   ├── imagekitUtils.js
│   │   ├── fileValidation.js
│   │   ├── fileCleanup.js      # File expiry check + ImageKit deletion helpers (used by scheduler)
│   │   ├── jwtUtils.js
│   │   ├── authCookie.js       # httpOnly session-cookie set/clear options + handshake cookie parsing
│   │   ├── allowedOrigins.js   # Shared CORS/CSRF origin allowlist + Referer parsing
│   │   ├── errorResponse.js    # Consistent error payloads with production message scrubbing
│   │   ├── tokenCleanup.js     # Clears expired password-reset and email-change tokens
│   │   ├── contactAttachments.js # Contact-form attachment count/size validation
│   │   ├── locationDerivation.js # Offline postal-code → city/district/state lookup (Berlin, Frankfurt)
│   │   ├── matchingScorer.js   # Shared scoring utilities
│   │   ├── searchQueryBuilder.js # Shared search distance/filter/sort SQL builders
│   │   ├── socketMessageEmitter.js
│   │   ├── turnstileVerify.js  # Cloudflare Turnstile CAPTCHA verification
│   │   ├── vacantRoleSerializer.js    # Serializes vacant role rows; builds creator and filled_by user sub-objects (id, name, avatar_url, is_public)
│   │   ├── badgeVisibilityUtils.js # Helpers for badge award visibility (hidden/shown state)
│   │   └── geocodingUtil.js    # resolveLocationData (full enrichment) + geocodeAddress (coords only)
│   ├── jobs/
│   │   ├── fileCleanupScheduler.js # node-cron job that calls fileCleanup utilities on a schedule
│   │   └── cleanupUnverifiedAccounts.js # Runs every 6 hours; deletes expired unverified accounts
│   └── database/
│       └── migrations/
│           └── create_contact_reports.js # Stores report submissions with reference IDs and mail status
├── scripts/                    # SQL seed, migration, and utility scripts
│   ├── migrate-cloudinary-to-imagekit.js   # One-time migration (already run): converted Cloudinary URLs to ImageKit URLs in the database
│   ├── add-location-district-columns.sql  # Migration: adds district column to teams/users/roles
│   ├── add-legal-consent-columns.sql      # Standalone SQL for the legal consent migration (see migrations/add_legal_consent_to_users.js)
│   └── backfill-location-data.js         # One-off script to backfill district/state from geocoding
├── test/                       # Controller and utility unit tests
│   ├── authController.login.test.js
│   ├── authController.emailChange.test.js
│   ├── csrfProtection.test.js
│   ├── errorResponse.test.js
│   ├── invitationController.test.js
│   ├── contactController.test.js
│   ├── locationDerivation.test.js
│   ├── searchController.test.js
│   ├── teamController.applyToJoinTeam.test.js
│   ├── teamController.applications.test.js
│   ├── userController.deleteUser.test.js
│   ├── userController.deletionPreview.test.js
│   ├── userController.emailUpdate.test.js
│   ├── userModel.legalConsent.test.js
│   └── vacantRoleController.test.js
├── docs/
│   ├── USER_DELETION_SPEC.md              # Full account deletion specification
│   ├── RESTORE_EMAIL_VERIFICATION_GUIDE.md # Email delivery (Nodemailer/SMTP) & verification flow
│   ├── team-service-boundaries.md         # Proposed service extraction boundaries
│   └── postman/                           # Postman collection exports for API testing
├── .env                        # Environment variables (not committed)
├── package.json
└── README.md
```

---

## API Routes

All routes are prefixed with `/api`.

| Prefix | Description |
|---|---|
| `/api/auth` | Register (requires `acceptedTerms`, `acceptedPrivacy`, `confirmedAge16`), login (sets the httpOnly session cookie), `POST /auth/logout` (clears it), email verification, password reset, verified email change (`PUT /auth/change-email` to request, `GET /auth/verify-email-change?token=...` to confirm); `POST /auth/check-username` for rate-limited username availability checks |
| `/api/users` | User CRUD, tags, badges, avatar, self-only blocklist endpoints, account deletion with preview |
| `/api/teams` | Team CRUD, members, applications, invitations, badge awards; `DELETE /invitations/:id/role` cancels only the role portion of a pending invitation |
| `/api/teams/:teamId/vacant-roles` | Vacant role CRUD and status management. Supports `?ids=1,2,3` for bulk filtering (bypasses the default status filter so polling can detect roles that transitioned to filled/closed). Role responses include `is_public` on the `creator` and `filled_by` user sub-objects. |
| `/api/search/global` | Keyword/boolean search across teams, users, and roles with tag/badge/location/role filtering |
| `/api/search/all` | Initial search-page data without a required keyword, using the same filtering/sorting core |
| `/api/matching` | Role ↔ user matching scores and candidate lists |
| `/api/badges` | Badge catalog and awarding |
| `/api/messages` | Direct and team message history |
| `/api/notifications` | User notifications (includes `referenceType`, `typeTeamCounts` in unread count response) |
| `/api/imagekit` | Auth params for client-side ImageKit uploads |
| `/api/tags` | Tag catalog (structured by category) |
| `/api/geocoding` | Postal code → city/district/country/coordinates lookup |
| `/api/contact` | Public contact form submission with optional file attachments forwarded by SMTP; `Report content or abuse` submissions are persisted first, return a `referenceId`, and trigger an automated acknowledgement-of-receipt email to the reporter |

---

## Search

The search API exposes two active routes:

- `GET /api/search/global` — keyword or boolean search. Requires `query` with at least 2 characters.
- `GET /api/search/all` — initial search-page load. Uses the same filters and sort options, but does not require a keyword.

Both routes share the same internal query-building core in `src/controllers/searchController.js`. Common distance and proximity SQL helpers live in `src/utils/searchQueryBuilder.js`; boolean query parsing lives in `src/utils/booleanSearchParser.js`.

Supported search controls include:

- `searchType`: `all`, `teams`, `users`, or `roles`
- `sortBy`: `name`, `recent`, `newest`, `capacity`, `proximity`, or `match`
- `sortDir`: `asc`, `desc`, or `remote`
- `tagIds`, `badgeIds`, `maxDistance`, `openRolesOnly`, `excludeOwnTeams`, `excludeTeamId`, `includeDemoData`

Authenticated user searches automatically exclude users who are in a block relationship with the requester, in either direction.

The team search response intentionally returns `teamavatarUrl` from the SQL alias `teamavatar_url as "teamavatarUrl"` for API compatibility with the frontend.

---

## User Blocking

Blocking is stored in the `user_blocks` table and is treated as a mutual visibility boundary throughout the backend:

- `GET /api/users/:id/blocks` — list users the authenticated user has blocked
- `POST /api/users/:id/blocks` — block another user using `blockedId` or `blocked_id`
- `DELETE /api/users/:id/blocks/:blockedId` — unblock a user
- `GET /api/users/:id/block-relationships` — return every user ID in a block relationship with the authenticated user, in either direction

Blocklist routes are self-only: `:id` must match the authenticated user. When either user has blocked the other, profiles are returned as not found, user search excludes the match, direct messages are blocked, unread/conversation counts skip blocked senders, and team-chat broadcasts such as messages, typing indicators, and read receipts exclude blocked user rooms where relevant.

---

## Real-Time Events (Socket.IO)

The server uses Socket.IO for real-time features. Clients authenticate from the httpOnly session cookie sent with the handshake (the browser sends it automatically via `withCredentials`); an explicit handshake auth token is still accepted as a fallback.

**Key events:**

| Event | Direction | Description |
|---|---|---|
| `message:new` | Client → Server | Send a direct or team message; accepts `replyToId` for threaded replies |
| `message:received` | Server → Client | New message broadcast; includes `replyTo` object (id, content preview, sender) when replying; also emitted for server-inserted system messages (role events, member changes, etc.) |
| `message:read` | Client → Server | Mark messages as read |
| `message:status` | Server → Client | Read receipt notification |
| `typing:start` / `typing:stop` | Bidirectional | Typing indicators |
| `blocks:updated` | Server → Client | Tells both affected users to re-sync block state after a block or unblock |
| `users:online` | Server → Client | Updated list of online user IDs |
| `team:member_left` | Server → Client | Member removal (e.g. account deletion) |
| `team:member_kicked` | Server → Client | Emitted to the removed member to kick them from the team chat |
| `conversation:deleted` | Server → Client | DM conversation removed |
| `notification:new` | Server → Client | New notification for the user — covers invitations, applications, member changes, role lifecycle events (`role_created`, `role_updated`, `role_deleted`, `role_closed`, `role_filled`, `role_reopened`), badge awards, `message_mention`, team deletion, and ownership transfers |
| `notification:updated` | Server → Client | Tells the client to re-fetch notifications — emitted on invitation cancellation, role invitation cancellation, stale notification cleanup (e.g. after member removal or role deletion), and admin action acknowledgements |

---

## Matching Engine

The matching system scores users against vacant roles (and vice versa) using three weighted dimensions:

| Dimension | Weight | Calculation |
|---|---|---|
| Tags | 40% | Overlap between user's tags and role's desired tags |
| Badges | 30% | Overlap between user's badges and role's desired badges |
| Distance | 30% | Haversine distance; remote roles score 1.0 for everyone |

Distance scoring: within `max_distance_km` → 1.0, up to 20 km beyond → 0.25 (grace zone), further → 0.0. No location data on either side → 0.5 (neutral).

The shared scoring logic lives in `src/utils/matchingScorer.js` and is used by both the matching controller (dedicated endpoints) and the search controller (Best Match sort).

---

## Geocoding and Location Enrichment

Location data for users, teams, and vacant roles is resolved through `src/utils/geocodingUtil.js` via `resolveLocationData()`. Given any combination of postal code, city, district, state, and country, it returns a fully enriched location object:

```json
{ "postal_code": "10117", "city": "Berlin", "district": "Mitte", "state": "Berlin", "country": "DE", "latitude": 52.516, "longitude": 13.388 }
```

**Resolution order:**

1. **Offline fallback** (`src/utils/locationDerivation.js`) — A built-in lookup table maps 200+ Berlin postal codes and select Frankfurt codes to their district, city, and state without any external call. Applied first as a fast pre-fill.
2. **Nominatim API** — If geocoding proceeds, up to three queries are attempted in order (full combined query → postal code + country → city + country), stopping at the first result.
3. **Country-only fallback** — If no specific result is found, the resolved object is returned without coordinates (coordinates are `null`, other known fields are preserved).

Registration, team creation/update, and user profile update all call `resolveLocationData()` and write back the full enriched object — so location fields (including `district` and `state`) are normalized on save, not just at query time.

The `district` field is stored in the `users`, `teams`, and `vacant_roles` tables. Existing rows can be backfilled with `scripts/backfill-location-data.js`; the required schema migration is `scripts/add-location-district-columns.sql`.

The public `GET /api/geocoding/postal-code/:code` endpoint is rate-limited (60 req/15 min) and backed by a bounded in-memory cache (24-hour TTL, max 1000 entries). Caching repeated postal-code lookups reduces outbound calls to Nominatim — respecting their usage policy and limiting how often user-entered locations leave the server. Definitive "no result" responses are cached, but transient Nominatim failures (timeouts/errors) are not, so lookups recover automatically.

---

## Scheduled Jobs

| Job | Schedule | Description |
|---|---|---|
| File cleanup | Configurable (see `fileCleanupScheduler.js`) | Expires and deletes orphaned ImageKit files |
| Unverified account cleanup | Every 6 hours | Deletes accounts where email verification expired more than 1 hour ago |

---

## Account Deletion

Full transactional account deletion following the spec in `docs/USER_DELETION_SPEC.md`. Key highlights:

- **Impact preview** — `POST /api/users/:id/deletion-preview` returns a password-verified summary of what will happen (teams transferred, teams deleted, roles reopened, counts)
- **Single transaction** — All cleanup runs in one database transaction with 6 phases (context gathering → message cleanup → team ownership → role/reference cleanup → user row deletion → post-transaction Socket.IO events)
- **Badge preservation** — Team names copied to `badge_awards.custom_team_name` before sole-owner teams are deleted
- **"Former Lomir User"** — Deleted user references display a grey silhouette avatar with no personal info
- **41+ automated tests** covering deletion scenarios and preview logic

---

## Security

| Measure | Details |
|---|---|
| Security headers | Helmet middleware sets standard HTTP security headers on every response |
| CSRF protection | Global `csrfProtection` middleware validates the `Origin`/`Referer` of every state-changing request (non-`GET`/`HEAD`/`OPTIONS`) against the CORS allowlist; cookie-authenticated requests without an origin are rejected. Non-browser API clients using `Authorization: Bearer` are unaffected |
| Request body cap | `express.json` and `express.urlencoded` limited to 1 MB |
| Rate limiting | 8 req/15 min on login/password flows; 10 req/hr on registration; 20 req/hr on username availability; 5 req/hr on contact form; 60 req/15 min on geocoding |
| CAPTCHA | Cloudflare Turnstile on registration and contact form (feature-flagged; skipped when `TURNSTILE_SECRET_KEY` is unset) |
| CORS | Allowlist: exact match for production URL + regex for Vercel preview deploys |
| Password policy | Min 8 chars, at least one letter and one number (registration, reset, change) |
| Socket.IO authorization | `conversation:join` validates team membership or existing DM before admitting the socket; direct conversations are denied when either user has blocked the other; `message:new` (team type) verifies the sender is a current team member before inserting |
| Error message scrubbing | Internal error details (`error.message`, stack traces) only included in responses when `NODE_ENV === "development"` |
| Logging | All debug `console.log` gated behind `NODE_ENV !== "production"`; errors and warnings always logged |
| SQL injection | Parameterized queries throughout |
| Auth | JWT on all protected routes, carried in an `httpOnly` `sameSite` cookie so it is not exposed to frontend JavaScript (XSS-resistant); bcrypt with 10 salt rounds |
| Legal consent | Registration requires `acceptedTerms`, `acceptedPrivacy`, and `confirmedAge16` (all must be `true`). The version of each document (`accepted_terms_version`, `accepted_privacy_version`, `confirmed_age_16_version`) and the acceptance timestamp are stored on the user row for audit purposes. |
| User data exposure | Public user listings return only public profiles (`is_public = TRUE`) with an explicit column allowlist; auth-aware profile/search reads also exclude users in a block relationship with the requester where supported; newly verified users remain private until they opt in; no `SELECT *` on user rows |

---

## Troubleshooting

- **`npm install` fails on bcrypt** — Install native build tools (see Prerequisites), then `rm -rf node_modules package-lock.json && npm install`
- **CORS errors** — Make sure `CLIENT_URL` in `.env` matches your frontend origin (`http://localhost:5173`)
- **Database connection issues** — Verify `DATABASE_URL` is correct and you have internet access
- **SMTP transport is not configured** — Set `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`; `SMTP_PORT` defaults to `587`
- **Port already in use** — `lsof -i :5001` to find the process, `kill -9 <PID>` to free the port
- **CAPTCHA not loading locally** — This is expected. If `TURNSTILE_SECRET_KEY` is unset, registration skips CAPTCHA.

---

## Related

- **Frontend repo:** [Lomir-frontend](https://github.com/KasparSinitsin/Lomir-frontend)
- **Deletion spec:** [`docs/USER_DELETION_SPEC.md`](docs/USER_DELETION_SPEC.md)
- **Email verification restore guide:** [`docs/RESTORE_EMAIL_VERIFICATION_GUIDE.md`](docs/RESTORE_EMAIL_VERIFICATION_GUIDE.md)

---

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for the full text.
