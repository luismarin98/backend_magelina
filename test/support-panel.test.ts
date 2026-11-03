import { reportType, supportChannelName } from '../src/modules/support/report-types.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionsBitField, PermissionFlagsBits as P, type Guild, type Interaction } from 'discord.js';
import { SupportConfig } from '../src/database/models/SupportConfig.js';
import { SupportTicket } from '../src/database/models/SupportTicket.js';
import { BotControl } from '../src/database/models/BotControl.js';
import { publishSupportPanel, supportPanel } from '../src/modules/support/panel.js';
import { faqInput, ticketScope, type supportContext } from '../src/modules/support/service.js';
import { handleSupportInteraction } from '../src/bot/support.js';

test('self service accepts only explicitly published answers and scopes case visibility', () => {
  assert.deepEqual(faqInput({ version: 0, faqs: [{ question: '¿Cómo obtengo acceso?', answer: 'Consulta las reglas.' }] }), [{ question: '¿Cómo obtengo acceso?', answer: 'Consulta las reglas.' }]);
  assert.throws(() => faqInput({ version: 0, faqs: Array.from({ length: 6 }, () => ({ question: 'Q', answer: 'A' })) }));
  assert.throws(() => faqInput({ version: 0, faqs: [{ question: 'Q', answer: 'A', internalArticleId: 'secret' }] }));
  assert.deepEqual(ticketScope('user', { canAdmin: false, canModerate: false }), { requesterId: 'user' });
  assert.deepEqual(ticketScope('mod', { canAdmin: false, canModerate: true }), { $or: [{ requesterId: 'mod' }, { assigneeId: 'mod' }] });
  assert.deepEqual(ticketScope('admin', { canAdmin: true, canModerate: true }), {});
  assert.deepEqual(supportPanel().components.map(row => row.components.map(button => { const value = button.toJSON(); return 'custom_id' in value ? value.custom_id : undefined; })).flat(), ['support:type', 'support:help']);
});

test('moderators publish one reusable panel; members use private help and submit pending requests without creating channels', async t => {
  const guildId = '100000000000000001', userId = '100000000000000002', botId = '100000000000000003', channelId = '100000000000000004', messageId = '100000000000000005';
  let creations = 0, sends = 0, edits = 0, tickets = 0;
  const permissions = new PermissionsBitField(P.Administrator);
  const category = { id: '100000000000000020', type: ChannelType.GuildCategory };
  const options: any[] = [];
  const channel = { parentId: category.id, id: channelId, type: ChannelType.GuildText, permissionsFor: () => permissions,
    send: async () => { sends++; return { id: messageId }; }, messages: { fetch: async () => ({ id: messageId, author: { id: botId }, edit: async () => { edits++; } }) } };
  const guild = { id: guildId, members: { fetch: async ({ user }: { user: string }) => ({ id: user }) }, channels: { create: async (input: any) => { creations++; options.push(input); return input.type === ChannelType.GuildCategory ? category : channel; }, fetch: async (id: string) => id === category.id ? category : channel } } as unknown as Guild;
  const config: any = { guildId, version: 0, faqs: [{ question: 'Acceso', answer: 'Revisa las reglas.' }], panelChannelId: null, panelMessageId: null, publishing: false, save: async () => {} };
  t.mock.method(SupportConfig, 'findOne', (() => ({ lean: async () => config })) as never);
  t.mock.method(SupportConfig, 'updateOne', (async (_filter: unknown, update: any) => { Object.assign(config, update.$set); }) as never);
  t.mock.method(SupportConfig, 'findOneAndUpdate', (async (_filter: unknown, update: any) => { Object.assign(config, update.$set); config.version++; return config; }) as never);
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  const requests = new Map<string, any>();
  t.mock.method(SupportTicket, 'findOne', (async (filter: any) => requests.get(filter.requestId) ?? null) as never);
  t.mock.method(SupportTicket, 'create', (async (input: any) => { tickets++; const result = { ...input, id: 'abcdefabcdefabcdefabcdef' }; requests.set(input.requestId, result); return result; }) as never);
  const ctx = { me: { id: botId, permissions }, actor: null, canModerate: true, canAdmin: true } as Awaited<ReturnType<typeof supportContext>>;
  await assert.rejects(publishSupportPanel(guild, userId, { ...ctx, canModerate: false }), /Solo los moderadores/);
  await publishSupportPanel(guild, userId, ctx); assert.equal(creations, 2); assert.equal(sends, 1);
  await publishSupportPanel(guild, userId, ctx); assert.equal(creations, 2); assert.equal(sends, 1); assert.equal(edits, 1);

  function interaction(kind: 'button' | 'modal' | 'select', customId: string, actor = userId) {
    const replies: any[] = [], modals: any[] = [];
    const i = { customId, user: { id: actor }, guildId, guild, channelId, message: { id: messageId }, deferred: false, replied: false,
      values: ['acceso'], isStringSelectMenu: () => kind === 'select', isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal',
      deferReply: async () => { i.deferred = true; }, editReply: async (payload: unknown) => { replies.push(payload); }, reply: async (payload: unknown) => { replies.push(payload); },
      showModal: async (modal: any) => { modals.push(modal.toJSON()); }, fields: { getTextInputValue: (name: string) => name === 'subject' ? 'Ayuda' : 'Necesito resolver un problema' } };
    return { i: i as unknown as Interaction, replies, modals };
  }
  const help = interaction('button', 'support:help'); await handleSupportInteraction(help.i);
  assert.equal(help.replies[0].embeds[0].toJSON().fields[0].value, 'Revisa las reglas.');
  const button = interaction('select', 'support:type'); await handleSupportInteraction(button.i);
  assert.equal(button.modals.length, 1);
  const modalId = button.modals[0].custom_id;
  const other = interaction('modal', modalId, '100000000000000099'); await handleSupportInteraction(other.i);
  assert.equal(tickets, 0); assert.match(other.replies[0].content, /otra persona/);
  const modal = interaction('modal', modalId); await handleSupportInteraction(modal.i);
  assert.equal(tickets, 1); assert.equal([...requests.values()][0].state, 'pending'); assert.equal([...requests.values()][0].reportType, 'acceso'); assert.equal(options[1].parent, category.id); assert.equal(creations, 2);
  assert.match(modal.replies[0].content, /administrador/);
  await handleSupportInteraction(interaction('modal', modalId).i); assert.equal(tickets, 1);
});

test('report types reject forged values and channel names normalize names safely', () => {
  assert.throws(() => reportType('admin'), /Selecciona/);
  assert.equal(reportType(undefined), 'consulta');
  assert.equal(supportChannelName('Jos\u00e9 @everyone', 'acceso', 'abcdef123456'), 'soporte-jose-everyone-acceso-123456');
  assert.equal(supportChannelName('!!!', 'otro', 'abcdef123456'), 'soporte-usuario-otro-123456');
});
