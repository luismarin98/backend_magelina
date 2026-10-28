import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { Collection, PermissionsBitField, PermissionFlagsBits as P, type Guild } from 'discord.js';
import type { AddressInfo } from 'node:net';
import type { guildAuthorization } from '../src/modules/permissions/access.js';
import { teamSpaceRoutes } from '../src/modules/moderation/team-space.js';
import { TeamSpace } from '../src/database/models/TeamSpace.js';
import { SystemEvent } from '../src/database/models/BotControl.js';
test('HTTP space preparation requires live authority, creates private channels and refuses a repeated version',async(t)=>{
 const guildId='100000000000000001',actorId='100000000000000002',roleId='100000000000000003',botId='100000000000000004';
 let actorBits:bigint=P.ModerateMembers,creates=0;
 const channels=new Collection();
 const actor={get permissions(){return new PermissionsBitField(actorBits);}};
 const roles=new Collection([[roleId,{id:roleId,managed:false,permissions:new PermissionsBitField(P.ModerateMembers)}]]);
 const guild={id:guildId,ownerId:'100000000000000009',roles:{fetch:async()=>roles},members:{fetchMe:async()=>({id:botId,permissions:new PermissionsBitField(P.Administrator)}),fetch:async()=>actor},channels:{fetch:async()=>channels,create:async(options:{type:number;permissionOverwrites:{id:string;deny?:bigint[]}[]})=>{
  creates++;assert.ok(options.permissionOverwrites.find(row=>row.id===guildId)?.deny?.includes(P.ViewChannel));
  return {id:String(100000000000000010n+BigInt(creates)),type:options.type};
 }}} as unknown as Guild;
 const record={_id:'abcdefabcdefabcdefabcdef',guildId,roleIds:[] as string[],categoryId:null as string|null,channels:[] as any[],locked:false,version:0,save:async()=>{}};
 t.mock.method(TeamSpace,'findOne',async()=>record);
 t.mock.method(TeamSpace,'findOneAndUpdate',async(filter:{version:number},update:{$set:{roleIds:string[]}})=>{
  if(filter.version!==record.version)return null;record.version++;record.roleIds=update.$set.roleIds;return record;
 });
 t.mock.method(TeamSpace,'updateOne',async()=>({}));t.mock.method(SystemEvent,'create',async()=>({}));
 const app=express();app.use(express.json());app.use(session({secret:'test-only',resave:false,saveUninitialized:false}));
 const access={requireAny:(req,_res,next)=>{req.managedGuild=guild;req.guildAccess={canConfigure:false,capabilities:[]};req.session.user={id:actorId,name:'Test',username:'test'};next();}} as ReturnType<typeof guildAuthorization>;
 app.use('/guilds/:guildId/team-space',teamSpaceRoutes(access));app.use(((err,_req,res,_next)=>res.status(err.status??500).json({error:err.publicMessage})) as express.ErrorRequestHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/guilds/${guildId}/team-space/prepare`;
 const body={version:0,roleIds:[roleId],categoryName:'Equipo',categoryId:null,channels:[{key:'notices',name:'avisos',type:'text',channelId:null}]};
 const post=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post()).status,403);assert.equal(creates,0);
  actorBits|=P.ManageChannels;assert.equal((await post()).status,403);assert.equal(creates,0);
  actorBits|=P.ManageRoles;assert.equal((await post()).status,200);assert.equal(creates,2);
  assert.equal(record.channels[0].status,'ready');
  assert.equal((await post()).status,409);assert.equal(creates,2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
