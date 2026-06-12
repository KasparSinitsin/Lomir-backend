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

Contact the project owner for a demo login, or register a new account with a valid email address (email verification is required).

---

## Features

- **Authentication** — JWT-based registration, login, email verification, and password reset. Transactional auth emails are sent through Nodemailer SMTP. Registration protected by Cloudflare Turnstile CAPTCHA (feature-flagged for local dev).
- **User Profiles** — CRUD with avatar uploads (ImageKit), interest tags, and badge portfolios
- **Teams** — Create, join, manage members, assign roles, and archive teams
- **Vacant Roles** — Post open positions on teams with desired tags, badges, and location preferences
- **Matching Engine** — Score users against roles (and vice versa) using weighted tag/badge/distance criteria
- **Search** — Global search across teams, users, and roles with boolean queries, tag/badge/location filtering, proximity sorting, and "Best Match" scoring
- **Chat** — Real-time direct and team group messaging via Socket.IO, including typing indicators, read receipts, message replies (reply-to with sender preview), @mention notifications, and structured system messages for team events (member join/leave/removal, role changes, invitation responses, application decisions, role lifecycle, team deletion)
- **Badge System** — 30 badges across 5 categories; award badges to teammates with reasons and context
- **Notifications** — In-app notifications for invitations, applications, badge awards, messages, @mentions, and role lifecycle events; each notification deep-links to the exact message that triggered it; stale notifications are cleaned up automatically on member removal, role deletion, and team deletion
- **Account Deletion** — Full transactional account deletion with impact preview, automatic team ownership transfer, role reopening, and "Former Lomir User" handling for preserved references
- **Contact Form** — Public `/api/contact` endpoint with Joi validation, Turnstile CAPTCHA, in-memory file attachments (up to 5), and SMTP forwarding; unexpected body fields are stripped defensively so multipart attachment fields cannot break validation; rate-limited to 5 submissions/hr
- **Geocoding** — Location enrichment via Nominatim: resolves a full location object (postal code, city, district, state, country, coordinates) from partial input. Built-in postal-code-to-district lookup for Berlin and Frankfurt (200+ mappings) used as a fast offline fallback before the API call. Works with country alone — does not require both postal code and city.
- **Security** — Helmet security headers, request body size cap (1 MB), rate limiting on auth and contact endpoints, CORS allowlist, password policy enforcement, Socket.IO conversation/message authorization, production error message scrubbing

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

# Skip email verification for local development if needed
SKIP_EMAIL_VERIFICATION=false

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

---

## Project Structure

```text
Lomir-backend/
├── src/
│   ├── app.js                  # Express app setup, middleware, route mounting
│   ├── server.js               # HTTP server + Socket.IO setup
│   ├── config/
│   │   ├── database.js         # PostgreSQL connection pool (Neon)
│   │   └── imagekit.js         # ImageKit client configuration
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
│   │   │                              #   Turnstile CAPTCHA, SMTP forwarding
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
│   │   ├── contactRoutes.js    # Contact form route with multer (up to 5 attachments)
│   │   ├── messageRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── matchingRoutes.js
│   │   ├── imagekitRoutes.js
│   │   ├── geocodingRoutes.js
│   │   └── api/
│   │       └── tags.js
│   ├── middlewares/
│   │   ├── auth.js             # JWT authentication middleware
│   │   ├── rateLimiter.js      # Rate limiting for auth endpoints
│   │   └── uploadMiddleware.js # Multer wrapper for file/image uploads
│   ├── services/
│   │   └── emailService.js     # Nodemailer SMTP transactional email; Resend restore notes kept in comments
│   ├── utils/
│   │   ├── booleanSearchParser.js
│   │   ├── imagekitUtils.js
│   │   ├── fileValidation.js
│   │   ├── fileCleanup.js      # File expiry check + ImageKit deletion helpers (used by scheduler)
│   │   ├── jwtUtils.js
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
├── scripts/                    # SQL seed, migration, and utility scripts
│   ├── migrate-cloudinary-to-imagekit.js   # One-time migration (already run): converted Cloudinary URLs to ImageKit URLs in the database
│   ├── add-location-district-columns.sql  # Migration: adds district column to teams/users/roles
│   └── backfill-location-data.js         # One-off script to backfill district/state from geocoding
├── test/                       # Controller unit tests
│   ├── invitationController.test.js
│   ├── searchController.test.js
│   ├── teamController.applyToJoinTeam.test.js
│   ├── userController.deleteUser.test.js
│   ├── userController.deletionPreview.test.js
│   ├── teamController.applications.test.js
│   └── vacantRoleController.test.js
├── docs/
│   ├── USER_DELETION_SPEC.md              # Full account deletion specification
│   ├── RESTORE_EMAIL_VERIFICATION_GUIDE.md # Steps to re-enable email verification
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
| `/api/auth` | Register, login, email verification, password reset; `POST /auth/check-email` and `/auth/check-username` for real-time availability checks |
| `/api/users` | User CRUD, tags, badges, avatar, account deletion with preview |
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
| `/api/contact` | Public contact form submission with optional file attachments forwarded by SMTP |

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

The team search response intentionally returns `teamavatarUrl` from the SQL alias `teamavatar_url as "teamavatarUrl"` for API compatibility with the frontend.

---

## Real-Time Events (Socket.IO)

The server uses Socket.IO for real-time features. Clients authenticate via JWT token in the handshake.

**Key events:**

| Event | Direction | Description |
|---|---|---|
| `message:new` | Client → Server | Send a direct or team message; accepts `replyToId` for threaded replies |
| `message:received` | Server → Client | New message broadcast; includes `replyTo` object (id, content preview, sender) when replying; also emitted for server-inserted system messages (role events, member changes, etc.) |
| `message:read` | Client → Server | Mark messages as read |
| `message:status` | Server → Client | Read receipt notification |
| `typing:start` / `typing:stop` | Bidirectional | Typing indicators |
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
| Request body cap | `express.json` and `express.urlencoded` limited to 1 MB |
| Rate limiting | 8 req/15 min on login/password flows; 10 req/hr on registration; 5 req/hr on contact form |
| CAPTCHA | Cloudflare Turnstile on registration and contact form (feature-flagged; skipped when `TURNSTILE_SECRET_KEY` is unset) |
| CORS | Allowlist: exact match for production URL + regex for Vercel preview deploys |
| Password policy | Min 8 chars, at least one letter and one number (registration, reset, change) |
| Socket.IO authorization | `conversation:join` validates team membership or existing DM before admitting the socket; `message:new` (team type) verifies the sender is a current team member before inserting |
| Error message scrubbing | Internal error details (`error.message`, stack traces) only included in responses when `NODE_ENV === "development"` |
| Logging | All debug `console.log` gated behind `NODE_ENV !== "production"`; errors and warnings always logged |
| SQL injection | Parameterized queries throughout |
| Auth | JWT on all protected routes, bcrypt with 10 salt rounds |
| User data exposure | `GET /api/users` returns only public profiles (`is_public = TRUE`) with an explicit column allowlist; no `SELECT *` on user rows |

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
