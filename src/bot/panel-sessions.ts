import { randomUUID } from 'node:crypto';
import { workflowError } from '../modules/workflow/rules.js';

/** Short-lived, user/guild-bound panels; never store Discord interaction tokens. */
export class PanelSessions<T> {
  private entries = new Map<string, { userId: string; guildId: string; expires: number; data: T }>();
  constructor(private readonly ttl = 300_000, private readonly limit = 1000, private readonly now = Date.now) {}
  create(userId: string, guildId: string, data: T): string {
    for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(id);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    const id = randomUUID();
    this.entries.set(id, { userId, guildId, data, expires: this.now() + this.ttl });
    return id;
  }
  get(id: string, userId: string, guildId: string): T {
    const entry = this.entries.get(id);
    if (!entry || entry.expires <= this.now()) {
      this.entries.delete(id);
      throw workflowError(409, 'Este menú venció o ya se utilizó. Ejecuta el comando de nuevo.');
    }
    if (entry.userId !== userId || entry.guildId !== guildId) throw workflowError(403, 'Este menú pertenece a otra persona o servidor. Abre el tuyo con el comando.');
    return entry.data;
  }
  take(id: string, userId: string, guildId: string): T {
    const data = this.get(id, userId, guildId);
    this.entries.delete(id);
    return data;
  }
}
