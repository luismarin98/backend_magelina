import { subcommands } from './commands/entertainment/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits as P, type Interaction, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import { PanelSessions } from './panel-sessions.js';
import { newGame, playGame, type Game, type GameKind, type TriviaTopic } from './game-rules.js';
import { assertAvailable } from '../modules/operations/service.js';
import { workflowError } from '../modules/workflow/rules.js';
import { logRecord } from '../observability/logging.js';

export { gamesCommand } from './commands/entertainment/index.js';

interface Session { game: Game; channelId: string }
export class GamePanels {
  readonly sessions = new PanelSessions<Session>();
  private cooldowns = new Map<string, number>();
  start(userId: string, guildId: string, channelId: string, kind: GameKind, topic: TriviaTopic = 'mixta') {
    const key = `${guildId}:${userId}`, now = Date.now();
    for (const [entry, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(entry);
    if ((this.cooldowns.get(key) ?? 0) > now) throw workflowError(429, 'Espera diez segundos entre partidas nuevas.');
    if (this.cooldowns.size >= 2000) throw workflowError(429, 'Hay muchas partidas iniciándose. Inténtalo en unos segundos.');
    const session = { game: newGame(kind, topic), channelId };
    this.cooldowns.set(key, now + 10_000);
    const token = this.sessions.create(userId, guildId, session);
    return gameView(session.game, token);
  }
}
const panels = new GamePanels();

export function gameView(game: Game, token: string) {
  const title = game.kind === 'trivia' ? 'Trivia de Magelina' : game.kind === 'ppt' ? 'Piedra, papel o tijera' : 'Adivina mi número';
  let description: string, choices: { label: string; value: string; disabled?: boolean }[] = [];
  if (game.kind === 'trivia') {
    description = game.finished ? `Partida terminada. Aciertos: **${game.score}/${game.questions.length}**.` : `Pregunta **${game.round + 1}/${game.questions.length}** · Aciertos: ${game.score}\n\n${game.questions[game.round]!.text}`;
    if (!game.finished) choices = game.questions[game.round]!.options.map((label, index) => ({ label, value: String(index) }));
  } else if (game.kind === 'ppt') {
    description = `Tú: **${game.score}** · Magelina: **${game.botScore}**\n` + (game.finished ? game.score === game.botScore ? '¡La partida terminó en empate!' : game.score > game.botScore ? '¡Ganaste la partida!' : 'Magelina ganó la partida.' : `Ronda **${game.round + 1}/3**. Elige tu jugada.`);
    if (!game.finished) choices = ['Piedra', 'Papel', 'Tijera'].map((label, index) => ({ label, value: String(index) }));
  } else {
    description = game.finished ? 'Partida terminada.' : `Estoy pensando en un número del **1 al 10**. Tienes **${3 - game.guesses.length}** intentos.\nProbados: ${game.guesses.join(', ') || 'ninguno'}.`;
    if (!game.finished) choices = Array.from({ length: 10 }, (_, index) => ({ label: String(index + 1), value: String(index + 1), disabled: game.guesses.includes(index + 1) }));
  }
  const embed = new EmbedBuilder().setColor(0xd94695).setTitle(title).setDescription(`${game.feedback ? `${game.feedback}\n\n` : ''}${description}`).setFooter({ text: game.finished ? 'Juega otra partida con /jugar. Los resultados no se guardan.' : 'Partida personal. Los botones vencen tras 5 minutos sin jugar.' });
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let offset = 0; offset < choices.length; offset += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(choices.slice(offset, offset + 5).map(choice => new ButtonBuilder().setCustomId(`game:${token}:${choice.value}`).setLabel(choice.label.slice(0, 80)).setStyle(ButtonStyle.Primary).setDisabled(choice.disabled ?? false))));
  if (!game.finished) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`game:${token}:salir`).setLabel('Terminar partida').setStyle(ButtonStyle.Secondary)));
  return { content: '', embeds: [embed], components: rows, allowedMentions: { parse: [] as never[] } };
}

async function authorize(i: ChatInputCommandInteraction | ButtonInteraction) {
  if (!i.guild) throw workflowError(400, 'Los juegos están disponibles dentro de los servidores.');
  await assertAvailable(i.guild.id);
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  const channel = await i.guild.channels.fetch(i.channelId);
  if (!channel || !('permissionsFor' in channel) || !channel.permissionsFor(member)?.has([P.ViewChannel, P.UseApplicationCommands])) throw workflowError(403, 'Necesitas acceso al canal y permiso para usar comandos de aplicaciones.');
}

export async function handleGames(interaction: Interaction, gamePanels = panels) {
  const slash = interaction.isChatInputCommand() && interaction.commandName === 'jugar';
  const button = interaction.isButton() && interaction.customId.startsWith('game:');
  if (!slash && !button) return;
  const i = interaction as ChatInputCommandInteraction | ButtonInteraction;
  try {
    if (slash && i.isChatInputCommand()) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await authorize(i);
      const command = subcommands.find(entry => entry.definition.name === i.options.getSubcommand());
      if (!command) throw workflowError(400, 'Comando desconocido.');
      await i.editReply(await command.execute(i, gamePanels));
      return;
    }
    if (!i.isButton() || !i.guildId) throw workflowError(400, 'Partida no válida.');
    const match = /^game:([a-f\d-]{36}):(salir|[0-9]|10)$/.exec(i.customId);
    if (!match) throw workflowError(400, 'Botón de juego no válido.');
    const session = gamePanels.sessions.get(match[1]!, i.user.id, i.guildId);
    if (session.channelId !== i.channelId) throw workflowError(403, 'Esta partida pertenece a otro canal.');
    const next = playGame(session.game, match[2]!);
    // Rotate one-use tokens before awaiting to reject concurrent/stale clicks.
    gamePanels.sessions.take(match[1]!, i.user.id, i.guildId);
    await i.deferUpdate();
    await authorize(i);
    const token = next.finished ? '' : gamePanels.sessions.create(i.user.id, i.guildId, { ...session, game: next });
    await i.editReply(gameView(next, token));
  } catch (error) {
    logRecord('bot.game.failed', { command: 'jugar', guildId: i.guildId, outcome: 'failed' });
    const content = error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string' ? error.publicMessage : 'No se pudo completar la partida. Inicia otra con /jugar.';
    try {
      if (i.deferred) await i.editReply({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { logRecord('bot.game.reply-failed', { guildId: i.guildId, outcome: 'failed' }); }
  }
}
