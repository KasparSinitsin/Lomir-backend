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

- **Authentication** — JWT-based registration, login, email verification, and password reset. Registration protected by Cloudflare Turnstile CAPTCHA (feature-flagged for local dev).
- **User Profiles** — CRUD with avatar uploads (ImageKit), interest tags, and badge portfolios
- **Teams** — Create, join, manage members, assign roles, and archive teams
- **Vacant Roles** — Post open positions on teams with desired tags, badges, and location preferences
- **Matching Engine** — Score users against roles (and vice versa) using weighted tag/badge/distance criteria
- **Search** — Global search across teams, users, and roles with boolean queries, tag/badge/location filtering, proximity sorting, and "Best Match" scoring
- **Chat** — Real-time direct and team group messaging via Socket.IO, including typing indicators, read receipts, message replies (reply-to with sender preview), @mention notifications, and structured system messages for team events (member join/leave/removal, role changes, invitation responses, application decisions, role lifecycle, team deletion)
- **Badge System** — 30 badges across 5 categories; award badges to teammates with reasons and context
- **Notifications** — In-app notifications for invitations, applications, badge awards, messages, @mentions, and role lifecycle events; each notification deep-links to the exact message that triggered it; stale notifications are cleaned up automatically on member removal, role deletion, and team deletion
- **Account Deletion** — Full transactional account deletion with impact preview, automatic team ownership transfer, role reopening, and "Former Lomir User" handling for preserved references
- **Geocoding** — Postal code lookup via Nominatim with built-in fallback mapping
- **Security** — Rate limiting on auth endpoints, CORS allowlist, password policy enforcement, production log scrubbing

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
| Email | Resend |
| Scheduling | node-cron |
| CAPTCHA | Cloudflare Turnstile |
| Rate Limiting | express-rate-limit |

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

# Resend (email service)
RESEND_API_KEY=<resend-api-key>

# Frontend URL (for CORS and email links)
CLIENT_URL=http://localhost:5173

# Skip email verification (set to "true" while no custom domain is configured)
SKIP_EMAIL_VERIFICATION=true

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
│   │   ├── messageRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── matchingRoutes.js
│   │   ├── imagekitRoutes.js
│   │   ├── geocodingRoutes.js
│   │   └── api/
│   │       └── tags.js
│   ├── middlewares/
│   │   ├── auth.js             # JWT authentication middleware
│   │   └── rateLimiter.js      # Rate limiting for auth endpoints
│   ├── services/
│   │   └── emailService.js     # Resend transactional email
│   ├── utils/
│   │   ├── booleanSearchParser.js
│   │   ├── imagekitUtils.js
│   │   ├── fileValidation.js
│   │   ├── jwtUtils.js
│   │   ├── matchingScorer.js   # Shared scoring utilities
│   │   ├── searchQueryBuilder.js # Shared search distance/filter/sort SQL builders
│   │   ├── socketMessageEmitter.js
│   │   ├── turnstileVerify.js  # Cloudflare Turnstile CAPTCHA verification
│   │   ├── vacantRoleSerializer.js
│   │   └── geocodingUtil.js
│   ├── jobs/
│   │   └── fileCleanupScheduler.js
│   └── database/
│       └── migrations/
├── scripts/                    # SQL seed, migration, and utility scripts
│   └── migrate-cloudinary-to-imagekit.js
├── test/                       # Controller unit tests
│   ├── invitationController.test.js
│   ├── searchController.test.js
│   ├── teamController.applyToJoinTeam.test.js
│   ├── userController.deleteUser.test.js
│   ├── userController.deletionPreview.test.js
│   ├── teamController.applications.test.js
│   └── vacantRoleController.test.js
├── docs/
│   ├── USER_DELETION_SPEC.md   # Full account deletion specification
│   └── team-service-boundaries.md # Proposed service extraction boundaries
├── .env                        # Environment variables (not committed)
├── package.json
└── README.md
```

---

## API Routes

All routes are prefixed with `/api`.

| Prefix | Description |
|---|---|
| `/api/auth` | Register, login, email verification, password reset |
| `/api/users` | User CRUD, tags, badges, avatar, account deletion with preview |
| `/api/teams` | Team CRUD, members, applications, invitations, badge awards; `DELETE /invitations/:id/role` cancels only the role portion of a pending invitation |
| `/api/teams/:teamId/vacant-roles` | Vacant role CRUD and status management. Supports `?ids=1,2,3` for bulk filtering (bypasses the default status filter so polling can detect roles that transitioned to filled/closed) |
| `/api/search/global` | Keyword/boolean search across teams, users, and roles with tag/badge/location/role filtering |
| `/api/search/all` | Initial search-page data without a required keyword, using the same filtering/sorting core |
| `/api/matching` | Role ↔ user matching scores and candidate lists |
| `/api/badges` | Badge catalog and awarding |
| `/api/messages` | Direct and team message history |
| `/api/notifications` | User notifications (includes `referenceType`, `typeTeamCounts` in unread count response) |
| `/api/imagekit` | Auth params for client-side ImageKit uploads |
| `/api/tags` | Tag catalog (structured by category) |
| `/api/geocoding` | Postal code → city/country/coordinates lookup |

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
| Rate limiting | 8 req/15 min on login/password flows, 10 req/hr on registration |
| CAPTCHA | Cloudflare Turnstile on registration (feature-flagged) |
| CORS | Allowlist: exact match for production URL + regex for Vercel preview deploys |
| Password policy | Min 8 chars, at least one letter and one number (registration, reset, change) |
| Logging | All debug `console.log` gated behind `NODE_ENV`; errors and warnings always logged |
| SQL injection | Parameterized queries throughout |
| Auth | JWT on all protected routes, bcrypt with 10 salt rounds |

---

## Troubleshooting

- **`npm install` fails on bcrypt** — Install native build tools (see Prerequisites), then `rm -rf node_modules package-lock.json && npm install`
- **CORS errors** — Make sure `CLIENT_URL` in `.env` matches your frontend origin (`http://localhost:5173`)
- **Database connection issues** — Verify `DATABASE_URL` is correct and you have internet access
- **Port already in use** — `lsof -i :5001` to find the process, `kill -9 <PID>` to free the port
- **CAPTCHA not loading locally** — This is expected. If `TURNSTILE_SECRET_KEY` is unset, registration skips CAPTCHA.

---

## Related

- **Frontend repo:** [Lomir-frontend](https://github.com/KasparSinitsin/Lomir-frontend)
- **Deletion spec:** [`docs/USER_DELETION_SPEC.md`](docs/USER_DELETION_SPEC.md)
