import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, escapeMarkdown, type Interaction, type Client } from 'discord.js';
import { PanelSessions } from './panel-sessions.js';
import { adventureServices as services } from './commands/adventure/services.js';
import { workflowError } from '../modules/workflow/rules.js';
import { logRecord } from '../observability/logging.js';

type Operation = { service: 'expedition' | 'economy' | 'join'; action: string; body: Record<string, unknown> };
type Choice = { label: string; detail: string; operation: Operation };
type ListKind = 'inventory' | 'market' | 'recipes' | 'sell' | 'countries';
type Panel = { title: string; description: string; choices?: Choice[]; kind?: ListKind; page?: number; quantity?: number; more?: boolean; confirmation?: boolean; busy?: boolean; done?: boolean };
const panels = new PanelSessions<Panel>();
const safe = (value: string, length = 100) => escapeMarkdown(value.replace(/[\r\n]/g, ' ').slice(0, length));
const fail = (message: string) => workflowError(409, message);
const button = (token: string, action: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`adv:${token}:${action}`).setLabel(label.slice(0, 80)).setStyle(style);
const baseView = (title: string, description: string) => ({ content: '', embeds: [new EmbedBuilder().setColor(0xd94695).setTitle(title.slice(0, 256)).setDescription(description.slice(0, 4096) || 'Sin resultados.').setFooter({ text: 'Menu personal valido por 5 minutos. Puedes volver a ejecutar el comando.' })], components: [] as ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[], allowedMentions: { parse: [] as never[] } });
function renderPanel(token: string, panel: Panel) {
  const view = baseView(panel.title, panel.description);
  if (panel.choices?.length) {
    view.components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`adv:${token}:select`).setPlaceholder('Elige una opcion').addOptions(panel.choices.map((choice, index) => ({ label: choice.label.slice(0, 100), description: choice.detail.slice(0, 100) || 'Ver detalles', value: String(index) })))));
  }
  if (panel.kind && ((panel.page ?? 0) > 0 || panel.more)) {
    view.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button(token, 'prev', 'Anterior').setDisabled(!panel.page), button(token, 'next', 'Siguiente').setDisabled(!panel.more)));
  }
  return view;
}
function savePanel(userId: string, guildId: string, panel: Panel) {
  const token = panels.create(userId, guildId, panel);
  return renderPanel(token, panel);
}
function confirmation(userId: string, guildId: string, choice: Choice) {
  const panel: Panel = { title: choice.label, description: choice.detail, choices: [choice], confirmation: true };
  const token = panels.create(userId, guildId, panel);
  const view = baseView(panel.title, panel.description);
  view.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button(token, 'confirm', 'Confirmar', ButtonStyle.Primary), button(token, 'cancel', 'Cancelar')));
  return view;
}
async function character(userId: string) {
  const result = await services.character(userId);
  if (!result) throw fail('Primero crea tu personaje con /aventura iniciar.');
  return result;
}
async function listView(kind: ListKind, userId: string, guildId: string, client: Client, page = 0, quantity = 1) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000) throw fail('Pagina no valida.');
  const player = await character(userId);
  const panel: Panel = { kind, page, quantity, title: '', description: '', choices: [] };
  if (kind === 'inventory' || kind === 'sell') {
    const state = await services.inventory(userId);
    const items = state.inventory.slice(page * 10, page * 10 + 10);
    panel.title = kind === 'sell' ? 'Vender objetos' : 'Tu inventario';
    panel.description = `Monedas: ${state.coins}\nPagina ${page + 1}\n\n` + items.map(item => `**${safe(item.name)}** x${item.quantity}\nID: \`${item.itemId}\` | Venta: ${item.sellPrice} monedas por unidad`).join('\n\n');
    panel.more = state.inventory.length > (page + 1) * 10;
    if (kind === 'sell') {
      if (!player.currentGuildId) throw fail('Viaja a un pais antes de vender.');
      panel.choices = items.filter(item => item.quantity >= quantity).map(item => ({ label: item.name, detail: `Vender ${quantity} unidades por ${quantity * item.sellPrice} monedas al mercado de ${safe(player.currentGuildName ?? 'tu pais')}.`, operation: { service: 'economy', action: 'sell', body: { itemId: item.itemId, quantity, guildId: player.currentGuildId } } }));
    }
  } else if (kind === 'market') {
    const result = await services.market(userId, guildId, page, client);
    panel.title = 'Mercado del gremio'; panel.more = result.more;
    panel.description = `Pagina ${page + 1}. Las compras requieren estar en este pais.\n\n` + result.items.map(item => `**${safe(item.itemName)}** x${item.quantity} | ${item.quantity * item.unitPrice} monedas${item.sellerId === userId ? ' (tu oferta)' : ''}`).join('\n\n');
    panel.choices = result.items.filter(item => item.sellerId !== userId).map(item => ({ label: item.itemName, detail: `Comprar el lote de ${item.quantity} unidades por ${item.quantity * item.unitPrice} monedas.`, operation: { service: 'economy', action: 'buy', body: { listingId: String(item._id), guildId } } }));
  } else if (kind === 'recipes') {
    const result = await services.recipes(page); panel.title = 'Fabricar objetos'; panel.more = result.more;
    panel.description = `Pagina ${page + 1}. Fabricar ${quantity} unidades.\n\n` + result.items.map(item => `**${safe(item.name)}**\n` + Object.entries(item.ingredients ?? {}).map(([id, amount]) => `${id}: ${amount * quantity}`).join(' | ')).join('\n\n');
    panel.choices = result.items.map(item => ({ label: item.name, detail: `Fabricar ${quantity} unidades. Materiales: ` + Object.entries(item.ingredients ?? {}).map(([id, amount]) => `${id}: ${amount * quantity}`).join(', '), operation: { service: 'economy', action: 'craft', body: { itemId: item.id, quantity } } }));
  } else {
    const result = await services.countries(userId, page, client); panel.title = 'Paises y viajes'; panel.more = result.more;
    panel.description = `Ubicacion: ${safe(player.currentGuildName ?? 'Refugio neutral')}\nPagina ${page + 1}. Viajar es gratuito. Para agregar destinos usa /aventura unirse en ese servidor.`;
    panel.choices = [{ id: null, name: 'Refugio neutral' }, ...result.items].map(country => ({ label: country.name, detail: `Viajar a ${safe(country.name)}. Tu inventario te acompana.`, operation: { service: 'economy', action: 'travel', body: { guildId: country.id, version: player.version } } }));
  }
  if (!panel.choices?.length && kind !== 'inventory') panel.description += '\n\nNo hay opciones disponibles en esta pagina.';
  return savePanel(userId, guildId, panel);
}
async function adventureView(userId: string, guildId: string, client: Client, mode = 'board') {
  const state = await services.board(userId, services.world(client), guildId);
  const run = state.active;
  if (run) {
    const rewards = `${run.rewards.wood} madera, ${run.rewards.herb} hierbas, ${run.rewards.experience} XP`;
    const loot = run.loot.map(item => `${safe(item.name)} x${item.quantity}`).join(', ');
    const panel: Panel = { title: run.title, description: `Etapa ${run.stage + (run.status === 'ready' ? 0 : 1)}/${run.totalStages} | Recompensas pendientes: ${rewards}${loot ? `\nBotin: ${loot}` : ''}`, choices: [] };
    const action = (name: string, label: string, detail: string, extra = {}) => panel.choices!.push({ label, detail, operation: { service: 'expedition', action: name, body: { runId: run.id, version: run.version, ...extra } } });
    if (mode === 'abandon') return confirmation(userId, guildId, { label: 'Abandonar aventura', detail: 'Perderas las recompensas pendientes. Tus pertenencias se conservan y el descanso no se reinicia.', operation: { service: 'expedition', action: 'abandon', body: { runId: run.id, version: run.version } } });
    if (run.status === 'ready') action('claim', 'Recoger recompensas', 'Entregar el botin y la experiencia pendientes a tu personaje.');
    else if (new Date(run.dueAt).getTime() > Date.now()) panel.description += `\n\nLa siguiente decision estara lista <t:${Math.ceil(new Date(run.dueAt).getTime() / 1000)}:R>. No hay penalizacion por desconectarte.`;
    else if (run.step?.encounter) {
      const enemy = run.step.encounter;
      panel.description += `\n\nEncuentro: **${safe(enemy.name)}**, nivel ${enemy.level}.`;
      action('decide', `Combatir (${enemy.fightChance} %)`, 'Victoria: materiales, experiencia y botin. Derrota: pierdes la mitad de cada recompensa pendiente y continuas.', { choice: 'fight' });
      action('decide', `Evitar (${enemy.avoidChance} %)`, 'Exito: continuas con 4 XP pendientes. Fallar termina el encargo sin recompensas.', { choice: 'avoid' });
    } else {
      panel.description += `\n\n${safe(run.step?.description ?? '', 500)}`;
      action('decide', 'Avanzar con cautela', '1 material y 4 XP garantizados.', { choice: 'careful' });
      action('decide', 'Explorar a fondo', '65 %: 3 materiales y 9 XP. Contratiempo: 2 XP y ningun material.', { choice: 'bold' });
    }
    if (mode === 'claim' && run.status !== 'ready') throw fail('Completa las etapas antes de recoger las recompensas.');
    if (run.events.length) panel.description += '\n\nUltimo evento: ' + safe(run.events.at(-1)!.text, 500);
    panel.description += '\n\nPara retirarte usa /aventura abandonar.';
    return savePanel(userId, guildId, panel);
  }
  if (mode !== 'board') throw fail('No tienes una aventura activa. Consulta /aventuras.');
  const resting = state.nextAdventureAt && new Date(state.nextAdventureAt).getTime() > Date.now();
  const choices = state.canStart && !resting ? state.offers.filter(offer => offer.minLevel <= state.characterLevel).map(offer => ({ label: offer.title, detail: `${offer.description} Nivel ${offer.minLevel}. ${Math.ceil(offer.seconds / 60)} minutos de recorrido. Podran aparecer enemigos. Durante la aventura no podras viajar ni recolectar.`, operation: { service: 'expedition' as const, action: 'start', body: { offerId: offer.id } } })) : [];
  return savePanel(userId, guildId, { title: 'Aventuras del gremio', description: (state.boardMessage || 'Elige un encargo para revisar y confirmar su inicio.') + (resting ? `\nDescanso hasta <t:${Math.ceil(new Date(state.nextAdventureAt!).getTime() / 1000)}:R>.` : '') + (!state.canStart ? '\nInscribete con /aventura unirse y viaja a este pais con /viajar.' : ''), choices });
}
export async function handleAdventure(interaction: Interaction) {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const i = interaction;
  try {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!i.guildId) throw fail('Usa estos comandos dentro de un servidor.');
    const userId = i.user.id, guildId = i.guildId;
    await services.available(guildId, undefined, false);
    await services.world(i.client).verify(userId, guildId);
    let view: ReturnType<typeof baseView>;
    if (!i.isChatInputCommand()) {
      const [, token, action] = i.customId.split(':');
      const panel = panels.get(token!, userId, guildId);
      if (panel.busy) throw fail('Esta operacion ya se esta procesando.');
      if (panel.done) throw fail('Esta operacion ya se completo. Ejecuta el comando para consultar el resultado.');
      if (action === 'cancel') { panel.done = true; view = baseView('Operacion cancelada', 'No se realizaron cambios.'); }
      else if ((action === 'next' || action === 'prev') && panel.kind) {
        if (action === 'next' && !panel.more || action === 'prev' && !panel.page) throw fail('Pagina no disponible.');
        view = await listView(panel.kind, userId, guildId, i.client, (panel.page ?? 0) + (action === 'next' ? 1 : -1), panel.quantity);
      } else {
        const index = action === 'confirm' ? 0 : i.isStringSelectMenu() && i.values.length === 1 && /^(?:[0-9]|10)$/.test(i.values[0]!) ? Number(i.values[0]) : -1;
        const choice = panel.choices?.[index];
        if (!choice || (action !== 'select' && action !== 'confirm') || (action === 'confirm' && !panel.confirmation) || (action === 'select' && panel.confirmation)) throw fail('Seleccion no valida.');
        if (action === 'select') {
          panel.done = true;
          view = confirmation(userId, guildId, choice);
        } else {
          panel.busy = true;
          try {
            await services.available(guildId);
            const op = choice.operation;
            let result: Record<string, unknown> = {};
            if (op.service === 'join') { await services.world(i.client).verify(userId, guildId); await services.join(userId, guildId); }
            else if (op.service === 'expedition') result = await services.expedition(userId, op.action, { ...op.body, key: token }, services.world(i.client));
            else result = await services.economy(userId, op.action, { ...op.body, key: token }, undefined, services.world(i.client));
            panel.done = true;
            const event = typeof result.event === 'string' ? `\n${safe(result.event, 600)}` : '';
            const loot = Array.isArray(result.loot) ? result.loot.map(item => `${safe(String(item.name))} x${item.quantity}`).join(', ') : '';
            view = baseView('Operacion completada', `${safe(choice.label)}.${event}${loot ? `\nBotin: ${loot}` : ''}\nConsulta /aventura continuar, /inventario o /mercado para ver el estado actualizado.`);
          } finally { panel.busy = false; }
        }
      }
    } else {
      const name = i.commandName;
      if (name === 'ayuda') view = baseView('Empezar a jugar', '**1.** /aventura iniciar: crea tu personaje.\n**2.** /aventura unirse: inscribete en un servidor con el juego habilitado.\n**3.** /viajar: viaja a ese pais.\n**4.** /aventuras: elige un encargo.\n**5.** /aventura continuar: resuelve las etapas.\n**6.** /aventura recoger: recoge tus recompensas.\n\n/perfil, /inventario, /mercado, /fabricar y /vender completan tus opciones. Solo puedes tener una aventura activa. Los menus vencen en cinco minutos; tu progreso se conserva.');
      else if (name === 'perfil') {
        const target = i.options.getUser('usuario') ?? i.user;
        const player = await services.character(target.id);
        if (!player) throw fail('Ese usuario todavia no ha creado su personaje.');
        view = baseView(`Personaje de ${safe(target.displayName)}`, `**${safe(player.alias)}**\n${player.profession === 'merchant' ? 'Comerciante' : player.profession === 'hunter' ? 'Cazador' : 'Sin profesion'} | Nivel ${player.level} | Rango ${safe(player.rank)}\nExperiencia: ${player.experience}`);
      } else if (name === 'aventura') {
        const action = i.options.getSubcommand();
        if (action === 'iniciar') {
          await services.available(guildId);
          const player = await services.start(userId, i.options.getString('alias') ?? (i.user.globalName ?? i.user.username).slice(0, 32), i.options.getString('profesion', true));
          view = baseView('Tu personaje', `${safe(player.alias)} | Nivel ${player.level} | Rango ${safe(player.rank)}.\nTu progreso se conserva. Usa /aventura unirse para inscribirte aqui.`);
        } else if (action === 'unirse') {
          await character(userId);
          view = confirmation(userId, guildId, { label: 'Unirse al gremio', detail: 'Inscribirte es voluntario y no reinicia tu personaje. Luego puedes viajar a este pais con /viajar.', operation: { service: 'join', action: 'join', body: {} } });
        } else view = await adventureView(userId, guildId, i.client, action === 'abandonar' ? 'abandon' : action === 'recoger' ? 'claim' : 'continue');
      } else if (name === 'aventuras') view = await adventureView(userId, guildId, i.client);
      else {
        const kinds: Record<string, ListKind> = { inventario: 'inventory', mercado: 'market', fabricar: 'recipes', vender: 'sell', viajar: 'countries' };
        if (!kinds[name]) throw fail('Comando de aventura no valido.');
        view = await listView(kinds[name]!, userId, guildId, i.client, 0, ['fabricar', 'vender'].includes(name) ? i.options.getInteger('cantidad') ?? 1 : 1);
      }
    }
    await i.editReply(view);
  } catch (error) {
    logRecord('bot.adventure.failed', { guildId: i.guildId, outcome: 'failed' });
    const content = error instanceof Error && 'publicMessage' in error && typeof error.publicMessage === 'string' ? error.publicMessage : 'No se pudo confirmar la operacion. Si usaste Confirmar, reintenta el mismo boton: no duplicara las recompensas.';
    try {
      if (i.deferred || i.replied) await i.editReply({ content, embeds: [], components: [], allowedMentions: { parse: [] } });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch { logRecord('bot.adventure.reply.failed', { guildId: i.guildId }); }
  }
}
