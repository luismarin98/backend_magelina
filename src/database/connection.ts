import mongoose from 'mongoose';
import { setServers } from 'node:dns/promises';

export async function connectDatabase(uri: string, dnsServers: string[] = []) {
  // Se aplica antes de cualquier consulta SRV/TXT y solo dentro de este proceso Node.
  if (dnsServers.length) setServers(dnsServers);
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}
