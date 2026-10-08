export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushService {
  send(pushToken: string, message: PushMessage): Promise<void>;
}

/** Records messages instead of sending them. Used in dev and tests. */
export class OutboxPushService implements PushService {
  readonly sent: Array<{ pushToken: string; message: PushMessage }> = [];
  async send(pushToken: string, message: PushMessage) {
    this.sent.push({ pushToken, message });
  }
}

/** Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushService implements PushService {
  constructor(private accessToken?: string, private log: (msg: string) => void = () => {}) {}
  async send(pushToken: string, message: PushMessage) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify({ to: pushToken, sound: 'default', ...message }),
      });
      if (!res.ok) this.log(`expo push failed: ${res.status}`);
    } catch (err) {
      // Push is best effort; never fail the request because of it.
      this.log(`expo push error: ${(err as Error).message}`);
    }
  }
}
