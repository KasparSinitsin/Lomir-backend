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

---

## Features

- **Authentication** - JWT-based registration, login, email verification, and password reset
- **User Profiles** - CRUD with avatar uploads (ImageKit), interest tags, and badge portfolios
- **Teams** - Create, join, manage members, assign roles, and archive teams
- **Vacant Roles** - Post open positions on teams with desired tags, badges, and location preferences
- **Matching Engine** - Score users against roles (and vice versa) using weighted tag/badge/distance criteria
- **Search** - Full-text search across teams, users, and roles with tag/badge/location filtering
- **Chat** - Real-time direct and team group messaging via Socket.IO, including typing indicators and read receipts
- **Badge System** - 30 badges across 5 categories; award badges to teammates with reasons and context
- **Notifications** - In-app notifications for invitations, applications, badge awards, and messages
- **Account Deletion** - Full transactional account deletion with impact preview, automatic team ownership transfer, role reopening, and "Former Lomir User" handling for preserved references
- **Geocoding** - Postal code lookup via Nominatim with built-in fallback mapping

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

---

## Getting Started

### Prerequisites

- **Node.js** v18+ and npm
- Internet access (database is hosted on Neon - no local PostgreSQL needed)
- Native build tools for `bcrypt`:
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools with C++ workload
  - Linux: `sudo apt install build-essential python3`

### 1. Clone and switch to `dev`

```bash
git clone https://github.com/KasparSinitsin/Lomir-backend.git
cd Lomir-backend
git checkout dev
git pull origin dev
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

# Skip email verification (interim — set to "true" while no custom domain is configured)
SKIP_EMAIL_VERIFICATION=true

# Cloudflare Turnstile (optional for local dev — if unset, CAPTCHA is skipped on registration)
# TURNSTILE_SECRET_KEY=<turnstile-secret-key>
```

> Get the ImageKit values from the project owner.

### 4. Run the server

```bash
npm run dev
```

The server starts on `http://localhost:5001` with hot reload via nodemon.

Verify it's running by visiting `http://localhost:5001` - you should see **"Lomir API is running..."**

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with nodemon (hot reload) |
| `npm start` | Start production server |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed the database with initial data |
| `npm test` | Run tests |

---

## Project Structure

```text
Lomir-backend/
|- src/
|  |- app.js                  # Express app setup, middleware, route mounting
|  |- server.js               # HTTP server + Socket.IO setup
|  |- config/
|  |  |- database.js          # PostgreSQL connection pool (Neon)
|  |  |- imagekit.js          # ImageKit client configuration
|  |- controllers/
|  |  |- authController.js
|  |  |- userController.js
|  |  |- teamController.js
|  |  |- searchController.js
|  |  |- badgeController.js
|  |  |- messageController.js
|  |  |- invitationController.js
|  |  |- notificationController.js
|  |  |- vacantRoleController.js
|  |  |- matchingController.js
|  |- routes/
|  |  |- index.js            # Central route registry
|  |  |- authRoutes.js
|  |  |- userRoutes.js
|  |  |- teamRoutes.js
|  |  |- searchRoutes.js
|  |  |- badgeRoutes.js
|  |  |- messageRoutes.js
|  |  |- notificationRoutes.js
|  |  |- matchingRoutes.js
|  |  |- imagekitRoutes.js
|  |  |- geocodingRoutes.js
|  |  |- api/
|  |  |  |- tags.js
|  |- middlewares/
|  |  |- auth.js             # JWT authentication middleware
|  |  |- rateLimiter.js      # Rate limiting for auth endpoints
|  |- utils/
|  |  |- imagekitUtils.js
|  |  |- fileValidation.js
|  |  |- jwtUtils.js
|  |  |- matchingScorer.js   # Shared scoring utilities
|  |  |- turnstileVerify.js  # Cloudflare Turnstile CAPTCHA verification
|  |- jobs/
|  |  |- fileCleanupScheduler.js
|  |- database/
|  |  |- migrations/
|- scripts/                  # SQL seed and migration scripts
|- test/                     # Controller unit tests
|  |- userController.deleteUser.test.js
|  |- userController.deletionPreview.test.js
|- .env                      # Environment variables (not committed)
|- package.json
|- README.md
```

---

## API Routes

All routes are prefixed with `/api`.

| Prefix | Description |
|---|---|
| `/api/auth` | Register, login, email verification, password reset |
| `/api/users` | User CRUD, tags, badges, avatar, account deletion with preview |
| `/api/teams` | Team CRUD, members, applications, invitations, badge awards |
| `/api/teams/:teamId/vacant-roles` | Vacant role CRUD and status management |
| `/api/search` | Global search with tag/badge/location/role filtering |
| `/api/matching` | Role <-> user matching scores and candidate lists |
| `/api/badges` | Badge catalog and awarding |
| `/api/messages` | Direct and team message history |
| `/api/notifications` | User notifications |
| `/api/imagekit` | Auth params for client-side ImageKit uploads |
| `/api/tags` | Tag catalog (structured by category) |
| `/api/geocoding` | Postal code -> city/country/coordinates lookup |

---

## Real-Time Events (Socket.IO)

The server uses Socket.IO for real-time features. Clients authenticate via JWT token in the handshake.

**Key events:**

| Event | Direction | Description |
|---|---|---|
| `message:new` | Client -> Server | Send a direct or team message |
| `message:received` | Server -> Client | New message broadcast |
| `message:read` | Client -> Server | Mark messages as read |
| `message:status` | Server -> Client | Read receipt notification |
| `typing:start` / `typing:stop` | Bidirectional | Typing indicators |
| `users:online` | Server -> Client | Updated list of online user IDs |
| `team:member_left` | Server -> Client | Emitted when a user is deleted, to each team they were in |
| `conversation:deleted` | Server -> Client | Emitted to DM partners when a user is deleted |
| `notification:new` | Server -> Client | Emitted for ownership transfers, role reopenings, and team dissolutions |

---

## Troubleshooting

- **`npm install` fails on bcrypt** - Install native build tools (see Prerequisites), then `rm -rf node_modules package-lock.json && npm install`
- **CORS errors** - Make sure `CLIENT_URL` in `.env` matches your frontend origin (`http://localhost:5173`)
- **Database connection issues** - Verify `DATABASE_URL` is correct and you have internet access
- **Port already in use** - `lsof -i :5001` to find the process, `kill -9 <PID>` to free the port

---

## Related

- **Frontend repo:** [Lomir-frontend](https://github.com/KasparSinitsin/Lomir-frontend)
