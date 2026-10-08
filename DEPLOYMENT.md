# Deploying the VLivIn backend

A step-by-step guide to running the backend locally, on a free staging server for the client team, and in production.
For production, read "Before you go live" first. Real sign-in is not finished yet.

## Free staging deployment for the client team (start here)

This setup costs nothing and gives the client team a public HTTPS and WebSocket URL to build against.
It uses **Render** (free web service) for the server and **Supabase** (free Postgres) for the database.
Limits below were checked on Render's and Supabase's pages on 2026-10-08. Check them again before relying on them.

| What | Free limit | What it means for you |
| --- | --- | --- |
| Render web service | Spins down after 15 minutes with no traffic. Waking takes about a minute | The first request after a quiet period is slow. Tell the client team |
| Render web service | 750 free instance hours per month per workspace | Enough for one always-on service. Services are suspended if the hours run out |
| Render WebSockets | Messages on an open socket keep the service awake. New connections wake it | Live games and drawing work, but an idle app may still sleep |
| Supabase database | 500 MB per project, 2 active projects, paused after 1 week of inactivity | Open the project in the Supabase dashboard to resume it. Data is kept |
| Render's own free Postgres | Expires 30 days after creation | **Do not use it.** Use Supabase instead |

**Staging sign-in.** The free setup runs with `ALLOW_DEV_AUTH=true`. The sign-in code comes back in the
response (`devCode`), so testers can sign in without SMS. Test tokens like `dev:user1:Asha` also work on
`POST /v1/auth/social`. Share this URL only with your client team. Never use this setting for real users.

### Steps (about 15 minutes)

1. **Database.** Create a free project at supabase.com. Open **Project Settings, Database, Connection string**,
   choose the **Session pooler** string and copy it. Replace the password placeholder with your database password.
2. **Render account.** Sign up at render.com and connect your GitHub account.
3. **Blueprint.** Click **New, Blueprint**, pick the `Vlivin-server` repo. Render reads `render.yaml` in the repo
   and creates the `vlivin-backend-staging` service on the free plan.
4. **Database setting.** When Render asks for `DATABASE_URL`, paste the Supabase string from step 1.
   `JWT_SECRET` is generated for you.
5. **Deploy.** Wait for the build to finish. The tables are created automatically on first start.
6. **Check it.** Open `https://<your-service>.onrender.com/health`. You should see `{"status":"ok",...}`.
7. **Send the client team** the base URL (`https://<your-service>.onrender.com/v1`), the realtime URL
   (`wss://<your-service>.onrender.com/v1/ws?token=<jwt>`) and the API reference doc.

### Test it end to end

```bash
BASE=https://<your-service>.onrender.com
curl -s -X POST $BASE/v1/auth/phone/request -H 'content-type: application/json' -d '{"phone":"+919800000001"}'
# -> {"devCode":"123456"}
curl -s -X POST $BASE/v1/auth/phone/verify -H 'content-type: application/json' -d '{"phone":"+919800000001","code":"123456"}'
# -> {"token":"...","isNew":true,"user":{...}}
```

### When you are ready for real users

Set `ALLOW_DEV_AUTH` to `false`, connect an SMS provider and real Apple/Google sign-in (section 7),
and move to a paid plan so the service does not sleep. Everything else in this guide still applies.

---

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
| `ALLOW_DEV_AUTH` | no | `false` | Staging only. `true` returns sign-in codes in responses and accepts test tokens. Never for real users |
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
4. **Staging only:** `ALLOW_DEV_AUTH=true` makes the server return sign-in codes and accept test
   tokens (`dev:<id>:<name>`). That is handy for the client team on a staging server.
   Never turn it on for a server with real users. The server logs a warning at start-up when it is on.
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
