import { ChannelType, PermissionFlagsBits as P, type GuildChannel } from 'discord.js';
import { object, text, strings, id, version } from '../common/input.js';
import { workflowError } from '../workflow/rules.js';
export function spaceInput(body: unknown) {
  const input = object(body,['version','roleIds','categoryName','categoryId','channels']);
  const roleIds = strings(input.roleIds,10,20).map(value=>id(value,true));
  if (!roleIds.length) throw workflowError(400,'Selecciona al menos un rol del equipo.');
  if (!Array.isArray(input.channels) || input.channels.length < 1 || input.channels.length > 8) throw workflowError(400,'Selecciona entre uno y ocho canales.');
  const channels = input.channels.map(value=>{
    const row = object(value,['key','name','type','channelId']);
    if (!['text','voice'].includes(String(row.type))) throw workflowError(400,'Tipo de canal no valido.');
    const key = text(row.key,30); if (!/^[a-z0-9-]+$/.test(key)) throw workflowError(400,'Clave de canal no valida.');
    return { key, name:text(row.name,100), type: String(row.type), channelId:row.channelId ? id(row.channelId,true) : null };
  });
  if (new Set(channels.map(row=>row.key)).size !== channels.length || new Set(channels.map(row=>row.name)).size !== channels.length) throw workflowError(400,'No repitas claves ni nombres.');
  const reused = channels.map(row=>row.channelId).filter(Boolean);
  if (new Set(reused).size !== reused.length) throw workflowError(400,'Cada canal debe tener una funcion distinta.');
  if (channels.some(row=>row.key==='notices' && row.type!=='text')) throw workflowError(400,'Los avisos necesitan un canal de texto.');
  return { version:version(input.version),roleIds,categoryName:text(input.categoryName,100),categoryId:input.categoryId ? id(input.categoryId,true) : null,channels };
}
/** Strict allowlist: existing overwrites are inspected, never silently changed. */
export function privateChannel(channel: GuildChannel, roleIds: string[], botId: string): boolean {
  if (![ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildVoice].includes(channel.type)) return false;
  const everyone = channel.permissionOverwrites.cache.get(channel.guild.id);
  if (!everyone?.deny.has(P.ViewChannel) || everyone.allow.has(P.ViewChannel)) return false;
  const allowed = new Set([...roleIds,botId]);
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.allow.has(P.ViewChannel) && !allowed.has(overwrite.id)) return false;
  }
  return roleIds.every(roleId=>channel.permissionOverwrites.cache.get(roleId)?.allow.has(P.ViewChannel)) && Boolean(channel.permissionOverwrites.cache.get(botId)?.allow.has(P.ViewChannel));
}
