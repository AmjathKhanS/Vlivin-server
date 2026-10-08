export interface Socketlike {
  readyState: number;
  send(data: string): void;
}

interface Client {
  userId: string;
  socket: Socketlike;
}

const OPEN = 1;

/** Couple-scoped realtime rooms (`couple:{id}`) for presence and live events. */
export class Hub {
  private rooms = new Map<string, Set<Client>>();

  join(coupleId: string, userId: string, socket: Socketlike): () => void {
    const client: Client = { userId, socket };
    let room = this.rooms.get(coupleId);
    if (!room) this.rooms.set(coupleId, (room = new Set()));
    room.add(client);
    return () => {
      room.delete(client);
      if (room.size === 0) this.rooms.delete(coupleId);
    };
  }

  isOnline(coupleId: string, userId: string): boolean {
    for (const c of this.rooms.get(coupleId) ?? []) if (c.userId === userId) return true;
    return false;
  }

  /** Send an event to everyone in the couple room (optionally skipping one user). */
  broadcast(coupleId: string, type: string, data: unknown, exceptUserId?: string): void {
    const msg = JSON.stringify({ type, data });
    for (const c of this.rooms.get(coupleId) ?? []) {
      if (c.userId === exceptUserId) continue;
      if (c.socket.readyState === OPEN) c.socket.send(msg);
    }
  }

  sendTo(coupleId: string, userId: string, type: string, data: unknown): void {
    const msg = JSON.stringify({ type, data });
    for (const c of this.rooms.get(coupleId) ?? []) {
      if (c.userId === userId && c.socket.readyState === OPEN) c.socket.send(msg);
    }
  }
}
