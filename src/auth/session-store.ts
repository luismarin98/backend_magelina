import MongoStore from 'connect-mongo';
import type { MongoClient } from 'mongodb';

/** connect-mongo puede entregar JSON u objeto tras descifrar, segun la version de kruptein. */
export function deserializeSession(value: unknown): unknown {
  const session: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error('Formato de sesion no valido.');
  return session;
}

export function createSessionStore(client: MongoClient, secret: string) {
  return MongoStore.create({
    client, collectionName: 'sessions', crypto: { secret },
    serialize: JSON.stringify,
    unserialize: deserializeSession,
  });
}
