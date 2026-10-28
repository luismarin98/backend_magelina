import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowLog, teamSummaryLog, automationLog } from '../src/discord/log-messages.js';
import { notifyChange } from '../src/modules/workflow/service.js';
const guildId='100000000000000001',actorId='100000000000000002';
test('workflow cards show state, actor, assignee, reference and event time without pinging',()=>{
 const at=new Date('2026-10-27T20:00:00Z');
 const payload=workflowLog({id:'abcdefabcdefabcdefabcdef',guildId,status:'completed',actorId,assigneeId:null,at,dashboardOrigin:'https://example.com',locale:'es'});
 const embed=payload.embeds[0].toJSON();assert.equal(embed.title,'Solicitud actualizada');
 assert.ok(embed.fields?.some(row=>row.value==='Completada'));assert.ok(embed.fields?.some(row=>row.value===`<@${actorId}>`));
 assert.ok(embed.fields?.some(row=>row.value==='Sin asignar'));assert.equal(embed.timestamp,at.toISOString());
 assert.deepEqual(payload.allowedMentions.parse,[]);assert.equal(payload.components[0].toJSON().components[0].type,2);
});
test('team summary contains only counts and updater, uses server language and clears old content',()=>{
 const payload=teamSummaryLog({guildId,actorId,pending:3,unassigned:2,locale:'en-US',dashboardOrigin:'https://example.com'});
 const embed=payload.embeds[0].toJSON();assert.equal(embed.title,'Team follow-up');assert.equal(payload.content,'');
 assert.equal(embed.fields?.[0].value,'3');assert.equal(embed.fields?.[1].value,'2');assert.deepEqual(payload.allowedMentions.parse,[]);
 assert.ok(!JSON.stringify(embed).includes('reason'));assert.equal(payload.components.length,1);
 const clear=teamSummaryLog({guildId,actorId,pending:0,unassigned:0}).embeds[0].toJSON();assert.equal(clear.color,0x22c55e);
});
test('invalid dashboard origins produce no external link and generic notices respect Discord size limits',()=>{
 for(const dashboardOrigin of ['http://example.com','https://user:pass@example.com','javascript:alert(1)','https://example.com/path'])assert.equal(workflowLog({id:'ref',guildId,status:'accepted',dashboardOrigin}).components.length,0);
 const notice=automationLog('x'.repeat(9000));assert.equal(notice.embeds[0].toJSON().description?.length,4000);assert.deepEqual(notice.allowedMentions.parse,[]);
});
test('workflow delivery sends an embed and a Discord rejection is reported without throwing',async()=>{
 let sent:ReturnType<typeof workflowLog>|undefined;
 const channel={guildId,guild:{preferredLocale:'en-US'},isTextBased:()=>true,isSendable:()=>true,send:async(payload:ReturnType<typeof workflowLog>)=>{sent=payload;}};
 const bot={channels:{fetch:async()=>channel}} as unknown as Parameters<typeof notifyChange>[0];
 assert.equal(await notifyChange(bot,{id:'ref',guildId,sourceChannelId:'channel',status:'accepted'},null,{actorId}),true);
 assert.equal(sent?.embeds[0].toJSON().title,'Request updated');
 channel.send=async()=>{throw Error('Discord unavailable');};
 assert.equal(await notifyChange(bot,{id:'ref',guildId,sourceChannelId:'channel',status:'accepted'}),false);
});
