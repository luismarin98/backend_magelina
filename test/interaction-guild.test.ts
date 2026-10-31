import test from 'node:test';
import assert from 'node:assert/strict';
import type { BaseInteraction, Guild } from 'discord.js';
import { interactionGuild } from '../src/bot/guild.js';

const id = '100000000000000001';
type GuildInteraction = Pick<BaseInteraction, 'guild' | 'guildId' | 'client'>;

test('DMs are rejected without requesting a guild', async () => {
  await assert.rejects(interactionGuild({ guildId: null, guild: null } as GuildInteraction), /solo está disponible en servidores/);
});

test('cached guilds need no REST request and an uncached guild is fetched by its interaction ID', async () => {
  const guild = { id } as Guild;
  assert.equal(await interactionGuild({ guildId: id, guild } as GuildInteraction), guild);
  let requested: string | undefined;
  const i = { guildId: id, guild: null, client: { guilds: { fetch: async (value: string) => { requested = value; return guild; } } } } as unknown as GuildInteraction;
  assert.equal(await interactionGuild(i), guild);
  assert.equal(requested, id);
});

test('missing bot access and temporary failures have different actionable errors', async () => {
  for (const code of [50001, 10004]) {
    const i = { guildId: id, guild: null, client: { guilds: { fetch: async () => { throw { code }; } } } } as unknown as GuildInteraction;
    await assert.rejects(interactionGuild(i), /añadir el bot al servidor/);
  }
  const i = { guildId: id, guild: null, client: { guilds: { fetch: async () => { throw new Error('network'); } } } } as unknown as GuildInteraction;
  await assert.rejects(interactionGuild(i), /Inténtalo de nuevo en unos momentos/);
});
