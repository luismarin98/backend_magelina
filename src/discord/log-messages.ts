import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { language } from '../i18n/index.js';
import type { WorkStatus } from '../types/contracts.js';
const labels = {
 es: { request:'Solicitud actualizada', state:'Estado actual', reference:'Referencia', actor:'Accion realizada por', assignee:'Responsable de la tarea', unassigned:'Sin asignar', summary:'Seguimiento del equipo', pending:'Revisiones vencidas', unowned:'Seguimientos sin responsable', updated:'Actualizado por', next:'Siguiente paso', help:'Revisa los pendientes y asigna responsables desde la dashboard. Estos recuentos no demuestran infracciones.', clear:'No hay revisiones vencidas ni seguimientos sin responsable.', open:'Abrir dashboard', footer:'Magelina / Registro del equipo', change:'El cambio de estado se guardo correctamente. Consulta el contexto antes de actuar.', automation:'Aviso automatico', submitted:'Pendiente', accepted:'Aceptada', in_progress:'En curso', completed:'Completada', rejected:'Rechazada' },
 en: { request:'Request updated', state:'Current status', reference:'Reference', actor:'Action performed by', assignee:'Task assignee', unassigned:'Unassigned', summary:'Team follow-up', pending:'Overdue reviews', unowned:'Unassigned follow-ups', updated:'Updated by', next:'Next step', help:'Review pending work and assign owners in the dashboard. These counts do not establish violations.', clear:'There are no overdue reviews or unassigned follow-ups.', open:'Open dashboard', footer:'Magelina / Team log', change:'The status change was saved successfully. Review the context before taking action.', automation:'Automated notice', submitted:'Pending', accepted:'Accepted', in_progress:'In progress', completed:'Completed', rejected:'Rejected' },
};
function identity(value?: string | null): string | undefined { return value && /^\d{17,20}$/.test(value) ? `<@${value}>` : undefined; }
function components(origin: string | undefined, guildId: string, section: string, label: string) {
 if(!origin || !/^\d{17,20}$/.test(guildId))return [];
 try { const url=new URL(origin);if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)return [];
 return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`${url.origin}/dashboard/servers/${guildId}/${section}`))];
 } catch{return [];}
}
export function workflowLog(input:{id:string;guildId:string;status:WorkStatus;actorId?:string;assigneeId?:string|null;at?:Date;locale?:string;dashboardOrigin?:string}) {
 const l=labels[language(input.locale)],color=input.status==='completed'?0x22c55e:input.status==='rejected'?0xf59e0b:0x60a5fa;
 const embed=new EmbedBuilder().setTitle(l.request).setDescription(l.change).setColor(color)
 .addFields({name:l.state,value:l[input.status],inline:true},{name:l.reference,value:input.id.slice(0,100),inline:true});
 const actor=identity(input.actorId);if(actor)embed.addFields({name:l.actor,value:actor,inline:true});
 if(input.assigneeId!==undefined)embed.addFields({name:l.assignee,value:identity(input.assigneeId) ?? l.unassigned,inline:true});
 embed.setTimestamp(input.at ?? new Date()).setFooter({text:l.footer});
 return {content:'',embeds:[embed],components:components(input.dashboardOrigin,input.guildId,'tasks',l.open),allowedMentions:{parse:[] as never[]}};
}
export function teamSummaryLog(input:{guildId:string;pending:number;unassigned:number;actorId:string;locale?:string;dashboardOrigin?:string}) {
 const l=labels[language(input.locale)],hasPending=input.pending>0 || input.unassigned>0;
 const embed=new EmbedBuilder().setTitle(l.summary).setColor(hasPending?0xf59e0b:0x22c55e).setDescription(hasPending?l.help:l.clear)
 .addFields({name:l.pending,value:String(input.pending),inline:true},{name:l.unowned,value:String(input.unassigned),inline:true},{name:l.updated,value:identity(input.actorId) ?? '-',inline:false})
 .setTimestamp().setFooter({text:l.footer});
 return {content:'',embeds:[embed],components:components(input.dashboardOrigin,input.guildId,'moderation',l.open),allowedMentions:{parse:[] as never[]}};
}
export function automationLog(content:string,locale?:string) {
 const l=labels[language(locale)];
 return {embeds:[new EmbedBuilder().setTitle(l.automation).setDescription(content.slice(0,4000)).setColor(0xa78bfa).setTimestamp().setFooter({text:l.footer})],allowedMentions:{parse:[] as never[]}};
}
