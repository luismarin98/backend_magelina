import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, ChannelType, type GuildChannel } from 'discord.js';
import { spaceInput, privateChannel } from '../src/modules/moderation/team-space-rules.js';
const guildId='100000000000000001',roleId='100000000000000002',botId='100000000000000003';
const input={version:0,roleIds:[roleId],categoryName:'Equipo',categoryId:null,channels:[{key:'notices',name:'avisos',type:'text',channelId:null}]};
test('space input rejects missing roles, duplicate destinations, injection and wrong notice type',()=>{
 assert.equal(spaceInput(input).channels[0].key,'notices');
 for(const patch of [{roleIds:[]},{channels:[]},{channels:[{...input.channels[0],type:'voice'}]},{channels:[input.channels[0],input.channels[0]]},{permissions:'8'},{version:-1}]) assert.throws(()=>spaceInput({...input,...patch}));
});
function channel(extra?:{id:string;allow:bigint}) {
 const overwrite=(id:string,allow=0n,deny=0n)=>({id,allow:new PermissionsBitField(allow),deny:new PermissionsBitField(deny)});
 const cache=new Collection<string,ReturnType<typeof overwrite>>();
 for(const item of [overwrite(guildId,0n,P.ViewChannel),overwrite(roleId,P.ViewChannel),overwrite(botId,P.ViewChannel)])cache.set(item.id,item);
 if(extra)cache.set(extra.id,overwrite(extra.id,extra.allow));
 return {type:ChannelType.GuildText,guild:{id:guildId},permissionOverwrites:{cache}} as unknown as GuildChannel;
}
test('reusing channels requires explicit private overwrites and rejects other role or member access',()=>{
 assert.equal(privateChannel(channel(),[roleId],botId),true);
 assert.equal(privateChannel(channel({id:'foreign-role',allow:P.ViewChannel}),[roleId],botId),false);
 assert.equal(privateChannel(channel({id:'foreign-member',allow:P.ViewChannel}),[roleId],botId),false);
 assert.equal(privateChannel(channel({id:guildId,allow:P.ViewChannel}),[roleId],botId),false);
 assert.equal(privateChannel(channel(),['100000000000000004'],botId),false);
});
