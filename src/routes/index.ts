import type { FastifyInstance, FastifyRequest } from 'fastify';
import { unauthorized } from '../lib/errors.js';
import { AuthService, updateProfile } from '../services/auth.js';
import * as board from '../services/board.js';
import * as coupleSvc from '../services/couple.js';
import * as games from '../services/games.js';
import * as loc from '../services/location.js';
import * as moi from '../services/moi.js';
import * as mood from '../services/mood.js';
import * as questions from '../services/questions.js';
import * as widgets from '../services/widgets.js';
import { publicUser, type Ctx } from '../services/context.js';
import { badRequest } from '../lib/errors.js';
import { parse, schemas } from './schemas.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export function registerRoutes(app: FastifyInstance, ctx: Ctx, auth: AuthService) {
  const uid = (req: FastifyRequest) => req.user.sub;
  const guard = { onRequest: [app.authenticate] };
  const issue = async (user: { id: string }) => ({ token: await app.jwt.sign({ sub: user.id }) });

  app.get('/health', async () => ({ status: 'ok', time: ctx.clock().toISOString() }));

  // ---- Auth -------------------------------------------------------------
  app.post('/v1/auth/phone/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => auth.requestOtp(parse(schemas.otpRequest, req.body).phone));

  app.post('/v1/auth/phone/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { phone, code } = parse(schemas.otpVerify, req.body);
      const { user, isNew } = await auth.verifyOtp(phone, code);
      return { ...(await issue(user)), isNew, user: publicUser(user) };
    });

  app.post('/v1/auth/social', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { provider, idToken } = parse(schemas.social, req.body);
      const { user, isNew } = await auth.socialSignIn(provider, idToken);
      return { ...(await issue(user)), isNew, user: publicUser(user) };
    });

  // ---- Profile ----------------------------------------------------------
  app.get('/v1/me', guard, async (req) => {
    const user = await ctx.store.getUser(uid(req));
    if (!user) throw unauthorized();
    return { ...publicUser(user), phone: user.phone, pairing: await coupleSvc.pairingStatus(ctx, user.id) };
  });
  app.patch('/v1/me', guard, async (req) => {
    const user = await updateProfile(ctx, uid(req), parse(schemas.profile, req.body));
    return publicUser(user);
  });
  app.put('/v1/me/push-token', guard, async (req) => {
    const { token } = parse(schemas.pushToken, req.body);
    await ctx.store.updateUser(uid(req), { pushToken: token });
    return { ok: true };
  });

  // ---- Pairing & couple -------------------------------------------------
  app.post('/v1/pairing/code', guard, async (req) => coupleSvc.createPairCode(ctx, uid(req)));
  app.get('/v1/pairing/status', guard, async (req) => coupleSvc.pairingStatus(ctx, uid(req)));
  app.post('/v1/pairing/join', { ...guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const couple = await coupleSvc.joinWithCode(ctx, uid(req), parse(schemas.join, req.body).code);
      reply.code(201);
      return { coupleId: couple.id };
    });
  app.get('/v1/couple', guard, async (req) => coupleSvc.describeCouple(ctx, uid(req)));
  app.patch('/v1/couple', guard, async (req) => {
    const c = await coupleSvc.updateCouple(ctx, uid(req), parse(schemas.couple, req.body));
    return { togetherSince: c.togetherSince, meetDate: c.meetDate };
  });
  app.delete('/v1/couple', guard, async (req, reply) => {
    await coupleSvc.unpair(ctx, uid(req));
    reply.code(204);
  });

  // ---- Mood & hugs ------------------------------------------------------
  app.post('/v1/moods', guard, async (req, reply) => {
    const { mood: m, note } = parse(schemas.mood, req.body);
    reply.code(201);
    return mood.saveMood(ctx, uid(req), m, note);
  });
  app.get('/v1/moods/week', guard, async (req) => mood.weeklyMoods(ctx, uid(req)));
  app.post('/v1/hugs', guard, async (req) => mood.sendHug(ctx, uid(req)));

  // ---- Location ---------------------------------------------------------
  app.get('/v1/location/sharing', guard, async (req) => loc.getMyLocationState(ctx, uid(req)));
  app.put('/v1/location/sharing', guard, async (req) => {
    const { mode, pauseMinutes } = parse(schemas.sharing, req.body);
    await loc.setSharing(ctx, uid(req), mode, pauseMinutes);
    return loc.getMyLocationState(ctx, uid(req));
  });
  app.put('/v1/location', guard, async (req) => {
    const { lat, lng } = parse(schemas.location, req.body);
    await loc.updateLocation(ctx, uid(req), lat, lng);
    return { ok: true };
  });
  app.get('/v1/location/partner', guard, async (req) => loc.partnerLocation(ctx, uid(req)));

  // ---- Daily questions --------------------------------------------------
  app.get('/v1/questions/packs', guard, async () => questions.listPacks());
  app.get('/v1/questions/today', guard, async (req) =>
    questions.todaysQuestion(ctx, uid(req), parse(schemas.pack, req.query).pack));
  app.post('/v1/questions/:id/answer', guard, async (req) =>
    questions.answerQuestion(ctx, uid(req), (req.params as { id: string }).id, parse(schemas.answer, req.body).text));

  // ---- Games ------------------------------------------------------------
  app.get('/v1/games', guard, async () => games.GAME_CATALOG);
  app.post('/v1/games/tic-tac-toe', guard, async (req) => games.startTicTacToe(ctx, uid(req)));
  app.get('/v1/games/:id', guard, async (req) => games.getGame(ctx, uid(req), (req.params as { id: string }).id));
  app.post('/v1/games/:id/moves', guard, async (req) =>
    games.playMove(ctx, uid(req), (req.params as { id: string }).id, parse(schemas.move, req.body).cell));
  app.post('/v1/games/:id/rematch', guard, async (req) =>
    games.rematch(ctx, uid(req), (req.params as { id: string }).id));
  app.post('/v1/games/:id/chat', guard, async (req, reply) => {
    reply.code(201);
    return games.sendChat(ctx, uid(req), (req.params as { id: string }).id, parse(schemas.chat, req.body).text);
  });

  // ---- Drawing board ----------------------------------------------------
  app.post('/v1/boards', guard, async (req) => {
    const fresh = (req.query as { fresh?: string }).fresh === 'true';
    return board.openBoard(ctx, uid(req), fresh);
  });
  app.get('/v1/boards/:id', guard, async (req) => board.getBoard(ctx, uid(req), (req.params as { id: string }).id));
  app.post('/v1/boards/:id/strokes', guard, async (req, reply) => {
    reply.code(201);
    return board.addStroke(ctx, uid(req), (req.params as { id: string }).id, parse(schemas.stroke, req.body));
  });
  app.post('/v1/boards/:id/undo', guard, async (req) => board.undoStroke(ctx, uid(req), (req.params as { id: string }).id));
  app.post('/v1/boards/:id/clear', guard, async (req) => board.clearBoard(ctx, uid(req), (req.params as { id: string }).id));
  app.post('/v1/boards/:id/save', guard, async (req) =>
    board.saveBoard(ctx, uid(req), (req.params as { id: string }).id, parse(schemas.save, req.body).snapshotUrl));

  // ---- Moi ---------------------------------------------------------------
  app.get('/v1/moi', guard, async (req) => moi.listMoi(ctx, uid(req), parse(schemas.moiQuery, req.query).type));
  app.post('/v1/moi/letters', guard, async (req, reply) => {
    const body = parse(schemas.letter, req.body);
    if (body.unlockAt && body.unlockAt <= ctx.clock()) {
      throw badRequest('invalid_unlock', 'unlockAt must be in the future');
    }
    reply.code(201);
    return moi.writeLetter(ctx, uid(req), body);
  });
  app.post('/v1/moi/photos', guard, async (req, reply) => {
    const { url, caption } = parse(schemas.photo, req.body);
    reply.code(201);
    return moi.addPhoto(ctx, uid(req), url, caption);
  });
  app.delete('/v1/moi/:id', guard, async (req, reply) => {
    await moi.deleteMoi(ctx, uid(req), (req.params as { id: string }).id);
    reply.code(204);
  });

  // ---- Widgets -----------------------------------------------------------
  app.get('/v1/widgets/summary', guard, async (req) => widgets.coupleSummary(ctx, uid(req)));

}
