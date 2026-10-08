# Deploying the VLivIn backend

A step-by-step guide to running the backend locally, on a staging server, and in production.
Read "Before you go live" first. Real sign-in is not finished yet.

## 1. What you need

| Item | Notes |
| --- | --- |
| Node.js 20 or newer | Only for running without Docker |
| A Postgres database | Supabase is the easiest. Any Postgres 14+ works |
| A host that runs Docker or Node | Render, Railway, Fly.io, a VPS, etc. |
| A long random secret | Used to sign login tokens (`JWT_SECRET`) |

## 2. Run it locally (2 minutes)

```bash
git clone https://github.com/AmjathKhanS/Vlivin-server.git
cd Vlivin-server
npm install
cp .env.example .env        # leave DATABASE_URL empty to use the in-memory store
npm run dev                 # http://localhost:3000
```

Check that it works:

```bash
curl http://localhost:3000/health
# {"status":"ok","time":"..."}
```

Run the checks before you change anything:

```bash
npm run typecheck
npm test            # in-memory store
npm run test:pg     # same tests on real Postgres (in-process, no server needed)
```

With no `DATABASE_URL` the server keeps everything in memory and prints a warning. Data is lost on restart.

## 3. Create the database (Supabase)

1. Create a project at supabase.com.
2. Open **Project Settings → Database → Connection string**.
3. Copy the **Session pooler** string (or the direct connection if your host supports IPv6).
   It looks like `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
4. Put it in `DATABASE_URL`.

You do not need to run any SQL by hand. When the server starts it applies the files in `db/migrations`
and records them in a `schema_migrations` table. To apply them without starting the server:

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

SSL is switched on automatically for any host that is not localhost.

## 4. Environment variables

| Variable | Required | Example / default | What it does |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `production` | Turns on production safety checks |
| `PORT` | no | `3000` | Port to listen on. Most hosts set this for you |
| `HOST` | no | `0.0.0.0` | Interface to listen on |
| `JWT_SECRET` | production | 32+ random characters | Signs login tokens. The server refuses to start in production without it |
| `JWT_EXPIRES_IN` | no | `30d` | How long a login lasts |
| `DATABASE_URL` | production | the Supabase string | Postgres connection. The server refuses to start in production without it |
| `CORS_ORIGINS` | no | `https://app.example.com` | Comma-separated allowed origins, or `*`. A native mobile app is not affected by CORS |
| `PAIR_CODE_TTL_HOURS` | no | `24` | How long an invite code lasts |
| `EXPO_ACCESS_TOKEN` | no | from expo.dev | Sends real push notifications. Without it, pushes are only recorded |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Never commit `.env`. It is already in `.gitignore`.

## 5. Deploy with Docker

The repo includes a `Dockerfile`.

```bash
docker build -t vlivin-backend .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="<your secret>" \
  -e DATABASE_URL="<your Supabase string>" \
  vlivin-backend
```

### On a hosting service (Render, Railway, Fly.io, ...)

The steps are the same on all of them:

1. Create a new **web service** from the GitHub repo `AmjathKhanS/Vlivin-server`. Choose the **Dockerfile** build.
2. Add the environment variables from section 4.
3. Set the health check path to `/health`.
4. Deploy. The first start creates the database tables.
5. Use the HTTPS address the host gives you as the API base URL in the mobile app.
   For realtime, use the same address with `wss://`, for example `wss://your-app.onrender.com/v1/ws?token=<jwt>`.

The host must allow WebSocket connections. All the services above do by default.

## 6. Check a live deployment

Replace `BASE` with your URL.

```bash
BASE=https://your-app.example.com
curl $BASE/health                                   # should return status ok
curl -i $BASE/v1/me                                 # should return 401 (login required)
```

## 7. Before you go live (read this)

These are not finished yet. The first two block real users from signing in.

1. **No SMS provider.** In production the sign-in code is not sent and is not shown, so phone sign-in cannot work yet.
   Fix: choose a provider (Twilio, MSG91, ...) and plug it in through `buildApp({ sms })` in `src/app.ts`.
2. **Apple and Google sign-in are not connected.** In production, `POST /v1/auth/social` returns 501 until a real token
   check is added.
3. **Run only one copy of the server.** Pending sign-in codes and the realtime rooms live in the server's memory.
   Two copies would break sign-in and stop partners seeing each other's live moves. Moving them to Redis is the fix before you scale out.
4. **Staging only:** setting `NODE_ENV=development` on a server makes it return sign-in codes and accept test
   tokens (`dev:<id>:<name>`). That is handy for testing the app on a private staging server.
   Never do this on a public server with real users.
5. **Image uploads.** The app uploads doodles and photos to storage itself (for example Supabase Storage) and sends the
   link to the API. There is no upload endpoint.
6. **Backups.** Turn on automatic backups for the database (Supabase has this on paid plans).
7. **Rotate keys.** If a GitHub token or secret was ever pasted into a chat or committed, revoke it and create a new one.

## 8. Common problems

| Problem | Cause and fix |
| --- | --- |
| `JWT_SECRET must be set to at least 32 characters` | Set a longer secret |
| `DATABASE_URL is required in production` | Add the connection string |
| Database connection times out | Use the Supabase **Session pooler** string, and check that your host can reach it |
| Realtime connects then drops | The host or proxy closes idle sockets. Send `{"type":"ping"}` every 25 seconds from the app |
| Everything resets after a restart | `DATABASE_URL` is empty, so it is using the in-memory store |
| `429 Too Many Requests` on sign-in | Rate limits protect the sign-in and pairing routes. Wait a minute |

## 9. Updating

```bash
git pull
npm install
npm run typecheck && npm test
```

Push to GitHub and your host redeploys. New database migrations are applied automatically on start.
To add a database change, create a new file such as `db/migrations/002_add_something.sql`. Do not edit `001_init.sql`.
