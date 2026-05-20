import type { FastifyReply } from 'fastify';
import type { SseEvent } from '@bvp/shared';

type Client = {
  userId: string;
  reply: FastifyReply;
};

const clients = new Set<Client>();

export function registerSseClient(userId: string, reply: FastifyReply) {
  const client: Client = { userId, reply };
  clients.add(client);
  reply.raw.on('close', () => clients.delete(client));
  return client;
}

export function broadcast(event: SseEvent) {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (c.userId === event.userId) {
      try {
        c.reply.raw.write(data);
      } catch {
        clients.delete(c);
      }
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
