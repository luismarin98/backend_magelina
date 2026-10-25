import test from 'node:test';
import assert from 'node:assert/strict';
import type { Interaction } from 'discord.js';
import { newGame, playGame } from '../src/bot/game-rules.js';
import { GamePanels, gameView, gamesCommand, handleGames } from '../src/bot/games.js';
import { BotControl } from '../src/database/models/BotControl.js';

const userId = '100000000000000001', guildId = '100000000000000002', channelId = '100000000000000003';
function firstButton(payload: ReturnType<typeof gameView>) {
  const button = payload.components[0]!.toJSON().components[0]!;
  assert.ok('custom_id' in button);
  return button.custom_id;
}

test('trivia selects five unique questions, shuffles answers and finishes with the right score', () => {
  for (const topic of ['mixta', 'general', 'musica'] as const) {
    let game = newGame('trivia', topic, () => 0);
    assert.equal(game.kind, 'trivia'); if (game.kind !== 'trivia') throw new Error('Wrong kind');
    assert.equal(new Set(game.questions.map(question => question.text)).size, 5);
    assert.ok(game.questions.every(question => question.options.length === 4));
    if (topic !== 'mixta') assert.ok(game.questions.every(question => question.topic === topic));
    for (let round = 0; round < 5; round++) {
      if (game.kind !== 'trivia') throw new Error('Wrong kind');
      game = playGame(game, String(game.questions[game.round]!.answer));
    }
    assert.equal(game.finished, true); if (game.kind === 'trivia') assert.equal(game.score, 5);
    assert.throws(() => playGame(game, '0'), /terminó/);
  }
});

test('rock paper scissors resolves all combinations and stops after three rounds', () => {
  for (let player = 0; player < 3; player++) for (let bot = 0; bot < 3; bot++) {
    const game = playGame(newGame('ppt'), String(player), () => bot);
    if (game.kind !== 'ppt') throw new Error('Wrong kind');
    const outcome = (player - bot + 3) % 3;
    assert.equal(game.score, Number(outcome === 1)); assert.equal(game.botScore, Number(outcome === 2));
  }
  let game = newGame('ppt');
  for (let round = 0; round < 3; round++) game = playGame(game, '1', () => 0);
  assert.equal(game.finished, true);
  if (game.kind === 'ppt') assert.equal(game.score, 3);
});

test('guessing provides hints, rejects repeat/invalid guesses and allows winning on the last attempt', () => {
  let game = newGame('adivina', 'mixta', () => 6);
  game = playGame(game, '1'); assert.match(game.feedback, /mayor/);
  assert.throws(() => playGame(game, '1'), /todavía/);
  assert.throws(() => playGame(game, '0'), /1 al 10/);
  assert.throws(() => playGame(game, '-1'), /no válida/);
  game = playGame(game, '8'); assert.match(game.feedback, /menor/);
  game = playGame(game, '7'); assert.equal(game.finished, true); assert.match(game.feedback, /Acertaste/);
  let lost = newGame('adivina', 'mixta', () => 6);
  for (const guess of ['1', '2', '3']) lost = playGame(lost, guess);
  assert.equal(lost.finished, true); assert.match(lost.feedback, /era 7/);
  assert.equal(gameView(lost, '').components.length, 0);
  assert.equal(playGame(newGame('ppt'), 'salir').finished, true);
});

function fake(customId?: string, actor = userId, channel = channelId) {
  let allowed = true;
  const edits: ReturnType<typeof gameView>[] = [], replies: unknown[] = [];
  const i = { commandName: 'jugar', guildId, channelId: channel, user: { id: actor }, deferred: false, customId,
    guild: { id: guildId, members: { fetch: async () => ({ id: actor }) }, channels: { fetch: async () => ({ permissionsFor: () => ({ has: () => allowed }) }) } },
    options: { getSubcommand: () => 'adivina', getString: () => null },
    isChatInputCommand: () => !customId, isButton: () => Boolean(customId),
    deferReply: async () => { i.deferred = true; }, deferUpdate: async () => { i.deferred = true; },
    editReply: async (payload: ReturnType<typeof gameView>) => { edits.push(payload); }, reply: async (payload: unknown) => { replies.push(payload); },
  };
  return { interaction: i as unknown as Interaction, edits, replies, deny: () => { allowed = false; } };
}

test('game buttons bind player/channel, rotate tokens, reject concurrent clicks and revalidate permission', async t => {
  t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => null })) as never);
  const panels = new GamePanels(), start = fake();
  await handleGames(start.interaction, panels);
  const initialId = firstButton(start.edits[0]!);
  const session = panels.sessions.get(initialId.split(':')[1]!, userId, guildId);
  if (session.game.kind !== 'adivina') throw new Error('Wrong kind');
  const wrongGuess = session.game.answer % 10 + 1;
  const buttonId = initialId.replace(/:[^:]+$/, `:${wrongGuess}`);
  const foreign = fake(buttonId, '100000000000000099');
  await handleGames(foreign.interaction, panels); assert.equal(foreign.edits.length, 0); assert.equal(foreign.replies.length, 1);
  const otherChannel = fake(buttonId, userId, '100000000000000088');
  await handleGames(otherChannel.interaction, panels); assert.equal(otherChannel.edits.length, 0);
  const left = fake(buttonId), right = fake(buttonId);
  await Promise.all([handleGames(left.interaction, panels), handleGames(right.interaction, panels)]);
  assert.equal(left.edits.length + right.edits.length, 1);
  assert.equal(left.replies.length + right.replies.length, 1);
  const result = (left.edits[0] ?? right.edits[0])!;
  assert.ok(result.components.length);
  {
    const nextButton = result.components.flatMap(row => row.toJSON().components).find(button => !button.disabled && 'custom_id' in button && !button.custom_id.endsWith(':salir'))!;
    assert.ok('custom_id' in nextButton);
    const nextId = nextButton.custom_id; assert.notEqual(nextId, buttonId);
    const denied = fake(nextId); denied.deny();
    await handleGames(denied.interaction, panels);
    assert.match(JSON.stringify(denied.edits), /permiso/);
    assert.equal(denied.edits[0]!.components.length, 0);
  }
});

test('new games honor maintenance, cooldown and Discord component limits', async t => {
  const panels = new GamePanels();
  panels.start(userId, guildId, channelId, 'trivia');
  assert.throws(() => panels.start(userId, guildId, channelId, 'ppt'), /diez segundos/);
  const control = t.mock.method(BotControl, 'findOne', (() => ({ lean: async () => ({ maintenance: true, blockedGuildIds: [] }) })) as never);
  const i = fake(); await handleGames(i.interaction, new GamePanels());
  assert.match(JSON.stringify(i.edits), /mantenimiento/);
  control.mock.restore();
  for (const kind of ['trivia', 'ppt', 'adivina'] as const) {
    const payload = gameView(newGame(kind), '11111111-1111-4111-8111-111111111111');
    assert.ok(payload.components.length <= 5);
    for (const row of payload.components) {
      const json = row.toJSON(); assert.ok(json.components.length <= 5);
      for (const button of json.components) {
        assert.ok('custom_id' in button && button.custom_id.length <= 100);
        assert.ok(button.label!.length <= 80);
      }
    }
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  }
  assert.deepEqual(gamesCommand.toJSON().options!.map(option => option.name), ['trivia', 'ppt', 'adivina']);
});
