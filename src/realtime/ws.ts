import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import * as board from '../services/board.js';
import * as games from '../services/games.js';
import { requireCouple, type Ctx } from '../services/context.js';
import { schemas } from '../routes/schemas.js';

const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('game.move'), gameId: z.string(), cell: z.number().int().min(0).max(8) }),
  z.object({ type: z.literal('game.chat'), gameId: z.string(), text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('board.stroke'), boardId: z.string(), stroke: schemas.stroke }),
  z.object({ type: z.literal('board.undo'), boardId: z.string() }),
  z.object({ type: z.literal('board.clear'), boardId: z.string() }),
]);

/**
 * Realtime channel: `GET /v1/ws?token=<jwt>` (or Authorization header).
 * Joins the couple room, relays presence, and applies game / board actions
 * through the same services the REST endpoints use.
 */
export function registerWs(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/ws', { websocket: true }, async (socket, req) => {
    const send = (type: string, data: unknown) => socket.send(JSON.stringify({ type, data }));
    const fail = (code: string, message: string) => send('error', { code, message });

    let userId: string;
    try {
      const header = req.headers.authorization?.replace(/^Bearer /i, '');
      const token = header ?? (req.query as { token?: string }).token;
      if (!token) throw new Error('missing token');
      userId = (app.jwt.verify(token) as { sub: string }).sub;
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }

    let coupleId: string;
    try {
      coupleId = (await requireCouple(ctx, userId)).couple.id;
    } catch {
      socket.close(4403, 'not_paired');
      return;
    }

    const leave = ctx.hub.join(coupleId, userId, socket);
    ctx.hub.broadcast(coupleId, 'presence', { userId, online: true }, userId);
    const partnerId = (await requireCouple(ctx, userId)).partnerId;
    send('ready', { coupleId, userId, partnerOnline: ctx.hub.isOnline(coupleId, partnerId) });

    socket.on('message', async (raw: Buffer) => {
      try {
        const parsed = clientMessage.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) return fail('validation_error', 'Unknown or malformed message');
        const m = parsed.data;
        switch (m.type) {
          case 'ping': return send('pong', { t: ctx.clock().toISOString() });
          case 'game.move': await games.playMove(ctx, userId, m.gameId, m.cell); return;
          case 'game.chat': await games.sendChat(ctx, userId, m.gameId, m.text); return;
          case 'board.stroke': await board.addStroke(ctx, userId, m.boardId, m.stroke); return;
          case 'board.undo': await board.undoStroke(ctx, userId, m.boardId); return;
          case 'board.clear': await board.clearBoard(ctx, userId, m.boardId); return;
        }
      } catch (err) {
        if (err instanceof AppError) fail(err.code, err.message);
        else fail('bad_message', 'Could not process message');
      }
    });

    socket.on('close', () => {
      leave();
      if (!ctx.hub.isOnline(coupleId, userId)) {
        ctx.hub.broadcast(coupleId, 'presence', { userId, online: false });
      }
    });
  });
}
