# VLivIn backend

REST + WebSocket backend for the VLivIn couples app (Phase 1 MVP): pairing, mood check-ins,
location sharing, daily questions, Tic Tac Toe, a live drawing board, the Moi space and the
home-screen widget summary. Built from the design handoff (`design_handoff_vlivin_phase1`).

Stack: Node 20+, TypeScript, Fastify 5, `@fastify/websocket`, JWT auth, Zod validation, Vitest.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full setup and hosting guide.

## Run

```bash
cp .env.example .env     # set JWT_SECRET (32+ chars) for production
npm install
npm run dev              # http://localhost:3000
npm run typecheck && npm test && npm run test:pg
npm run build && npm start
```

## Status and known gaps

- **Storage:** set `DATABASE_URL` to use Postgres (`src/store/postgres.ts`); migrations in
  `db/migrations` run on boot (or `npm run db:migrate`). Without it the server uses an in-memory store
  and logs a warning. `DATABASE_URL` is required in production. The same test suite also runs on real
  Postgres via `npm run test:pg` (in-process PGlite, no server needed).
- **OTP codes are still held in memory,** so a restart drops pending codes and running more than one
  instance would break sign-in. Move them to a table or Redis before scaling out.
- **SMS is not wired up.** OTPs are generated and returned as `devCode` outside production only.
  Provide an `SmsSender` (Twilio, MSG91, ...) in `buildApp({ sms })`.
- **Apple/Google sign-in:** a `SocialVerifier` must be supplied in production (verify the id token
  against Apple/Google JWKS). Without one, `/v1/auth/social` returns 501. In dev it accepts
  `dev:<sub>:<name>` tokens.
- **Push** uses the Expo Push API when `EXPO_ACCESS_TOKEN` is set, otherwise it records messages only.
- **Games:** only Tic Tac Toe is playable. The other six games in the Play grid are listed as
  `available: false` in `GET /v1/games`.
- **Image upload:** the client uploads doodle PNGs and photos to object storage and sends the https URL.
- Movie nights (watch room, companion mode) are Phase 2 and not included.

## Conventions

All routes except `/health` and `/v1/auth/*` need `Authorization: Bearer <jwt>`. Errors look like
`{ "error": { "code": "not_your_turn", "message": "..." } }`. Dates are ISO 8601; `togetherSince` and
`meetDate` are `YYYY-MM-DD`. Day counts use UTC calendar days.

## REST API

| Area | Endpoint |
| --- | --- |
| Auth | `POST /v1/auth/phone/request` `{phone}` · `POST /v1/auth/phone/verify` `{phone, code}` · `POST /v1/auth/social` `{provider, idToken}` |
| Profile | `GET/PATCH /v1/me` · `PUT /v1/me/push-token` `{token}` |
| Pairing | `POST /v1/pairing/code` · `GET /v1/pairing/status` · `POST /v1/pairing/join` `{code}` |
| Couple | `GET/PATCH/DELETE /v1/couple` (PATCH `{togetherSince, meetDate}`) |
| Mood | `POST /v1/moods` `{mood, note?}` · `GET /v1/moods/week` · `POST /v1/hugs` |
| Location | `PUT/GET /v1/location/sharing` `{mode: off\|always\|while_using, pauseMinutes?}` · `PUT /v1/location` `{lat,lng}` · `GET /v1/location/partner` |
| Questions | `GET /v1/questions/packs` · `GET /v1/questions/today?pack=` · `POST /v1/questions/:id/answer` `{text}` |
| Games | `GET /v1/games` · `POST /v1/games/tic-tac-toe` · `GET /v1/games/:id` · `POST /v1/games/:id/moves` `{cell}` · `POST /v1/games/:id/rematch` · `POST /v1/games/:id/chat` `{text}` |
| Drawing | `POST /v1/boards[?fresh=true]` · `GET /v1/boards/:id` · `POST /v1/boards/:id/{strokes,undo,clear,save}` |
| Moi | `GET /v1/moi?type=` · `POST /v1/moi/letters` `{title?, body, unlockAt?}` · `POST /v1/moi/photos` `{url, caption?}` · `DELETE /v1/moi/:id` |
| Widgets | `GET /v1/widgets/summary` |

Privacy rules enforced server-side: the partner's daily answer stays hidden until you answer;
location is opt-in, turning it off deletes coordinates and "Pause 1h" hides them; sealed letters hide
their body from the recipient until `unlockAt`; every resource is scoped to the caller's couple.

## Realtime

Connect to `ws(s)://host/v1/ws?token=<jwt>` (or an `Authorization` header). The socket joins the
couple room and receives `ready`, `presence`, `mood.updated`, `hug.received`, `question.answered`,
`location.updated`, `game.updated` and `game.chat`, `board.stroke`, `board.undo`, `board.clear`,
`widget.refresh`, `couple.paired`, `couple.unpaired`. Each message is `{ "type": string, "data": ... }`.
`game.updated` is sent per player from their own perspective (`mySymbol`, `yourTurn`).

Client messages: `ping`, `game.move {gameId, cell}`, `game.chat {gameId, text}`,
`board.stroke {boardId, stroke}`, `board.undo {boardId}`, `board.clear {boardId}`. Failures come back
as `{ "type": "error", "data": { code, message } }`.
