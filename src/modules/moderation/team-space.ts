import { t, withLanguage } from '../../i18n/index.js';
import { Router } from 'express';
import { ChannelType, PermissionFlagsBits as P, type Guild, type GuildChannel } from 'discord.js';
import type { guildAuthorization } from '../permissions/access.js';
import { TeamSpace } from '../../database/models/TeamSpace.js';
import { ModerationFollowup } from '../../database/models/ModerationFollowup.js';
import { spaceInput, privateChannel } from './team-space-rules.js';
import { workflowError } from '../workflow/rules.js';
import { logEvent } from '../operations/service.js';
import { canReview } from './rules.js';
import { object, version } from '../common/input.js';
import { hasCode } from '../../types/errors.js';

async function context(guild: Guild, actorId: string, owner: boolean) {
  const [me,actor,channels,roles] = await Promise.all([guild.members.fetchMe({force:true}), owner ? Promise.resolve(null) : guild.members.fetch({user:actorId,force:true}),guild.channels.fetch(),guild.roles.fetch()]);
  const permissions = [P.ManageChannels,P.ManageRoles];
  const canManage = me.permissions.has(permissions) && (!actor || actor.permissions.has(permissions));
  return {me,actor,channels,roles,canManage};
}
export function teamSpaceRoutes(access: ReturnType<typeof guildAuthorization>) {
  const router = Router({mergeParams:true}); router.use(access.requireAny);
  router.use(async (req,res,next)=>{
    const ctx = await context(req.managedGuild!,req.session.user!.id,req.guildAccess!.source==='bot-owner' || req.managedGuild!.ownerId===req.session.user!.id);
    if (ctx.actor && !canReview(ctx.actor)) throw workflowError(403,'Necesitas permisos nativos de moderacion.');
    res.locals.spaceContext=ctx; next();
  });
  router.get('/',async(req,res)=>{
    const ctx = res.locals.spaceContext as Awaited<ReturnType<typeof context>>;
    const space = await TeamSpace.findOne({guildId:req.managedGuild!.id}).lean();
    res.json({space,canManage:ctx.canManage,roles:[...ctx.roles.values()].filter(role=>role.id!==req.managedGuild!.id && !role.managed && role.permissions.any(P.ModerateMembers|P.KickMembers|P.BanMembers|P.ManageGuild)).map(role=>({id:role.id,name:role.name})),channels:[...ctx.channels.values()].filter(channel=>channel && [ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildVoice].includes(channel.type) && (!ctx.actor || channel.permissionsFor(ctx.actor)?.has(P.ViewChannel))).map(channel=>({id:channel!.id,name:channel!.name,type:channel!.type}))});
  });
  router.post('/prepare',async(req,res)=>{
    const ctx = res.locals.spaceContext as Awaited<ReturnType<typeof context>>;
    if (!ctx.canManage) throw workflowError(403,'El usuario y el bot necesitan Gestionar canales y Gestionar roles para configurar permisos privados.');
    const guild=req.managedGuild!,actorId=req.session.user!.id,input=spaceInput(req.body);
    for (const roleId of input.roleIds) {
      const role=ctx.roles.get(roleId);
      if (!role || role.id===guild.id || role.managed || !role.permissions.any(P.ModerateMembers|P.KickMembers|P.BanMembers|P.ManageGuild)) throw workflowError(400,'Selecciona roles de moderacion propios del servidor.');
    }
    const validate=(channelId:string,type:number)=>{
      const channel=ctx.channels.get(channelId);
      if (!channel || channel.type!==type || !privateChannel(channel,input.roleIds,ctx.me.id) || !channel.permissionsFor(ctx.me)?.has([P.ViewChannel,P.ManageChannels]) || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has([P.ViewChannel,P.ManageChannels]))) throw workflowError(400,'El canal existente no cumple los permisos privados esperados o no permite gestionarlo. No se modificaron sus permisos.');
      return channel;
    };
    if (input.categoryId) validate(input.categoryId,ChannelType.GuildCategory);
    for (const row of input.channels) if (row.channelId) {
      const channel=validate(row.channelId,row.type==='text'?ChannelType.GuildText:ChannelType.GuildVoice);
      if (!input.categoryId || channel.parentId!==input.categoryId) throw workflowError(400,'Los canales reutilizados deben pertenecer a la categoria seleccionada.');
    }
    let space=await TeamSpace.findOne({guildId:guild.id});
    if (!space) { try { space=await TeamSpace.create({guildId:guild.id}); } catch(error) { if(hasCode(error,11000)) throw workflowError(409,'Otra persona preparo este espacio. Actualiza.');throw error; } }
    if (space.roleIds.length && [...space.roleIds].sort().join()!==[...input.roleIds].sort().join()) throw workflowError(409,'Conserva los roles originales del espacio. Los cambios de permisos deben revisarse en Discord.');
    if (space.categoryId && input.categoryId!==space.categoryId) throw workflowError(409,'Reutiliza la categoria ya registrada.');
    for (const prior of space.channels) {
      if(prior.key==='category-pending') continue;
      const row=input.channels.find(row=>row.key===prior.key);
      if (!row || row.type!==prior.type || (prior.channelId && (row.channelId!==prior.channelId || row.name!==prior.name))) throw workflowError(409,'Conserva los canales registrados para evitar duplicados.');
    }
    const saved=await TeamSpace.findOneAndUpdate({_id:space._id,version:input.version,locked:false},{$set:{locked:true,roleIds:input.roleIds},$inc:{version:1}},{new:true});
    if(!saved) throw workflowError(409,'El espacio cambio o hay una operacion en curso. Actualiza antes de continuar.');
    space=saved;
    const overwrites=[{id:guild.id,deny:[P.ViewChannel]},{id:ctx.me.id,allow:[P.ViewChannel,P.ManageChannels,P.ManageRoles,P.SendMessages,P.ReadMessageHistory,P.Connect,P.Speak]},...input.roleIds.map(id=>({id,allow:[P.ViewChannel,P.SendMessages,P.ReadMessageHistory,P.Connect,P.Speak]}))];
    try {
      if (!space.categoryId && input.categoryId) {space.categoryId=input.categoryId;space.channels.splice(0,space.channels.length);await space.save();}
      if (!space.categoryId) {
        if ([...ctx.channels.values()].some(channel=>channel?.type===ChannelType.GuildCategory && channel.name===input.categoryName)) throw workflowError(409,'Ya existe una categoria con ese nombre. Seleccionala para reutilizarla.');
        // Persist intent before Discord mutation; uncertain outcomes require explicit reconciliation.
        if(space.channels.some(row=>row.key==='category-pending')) throw workflowError(409,'La creacion anterior de categoria no se confirmo. Revisa Discord y selecciona su ID.');
        space.channels.push({key:'category-pending',name:input.categoryName,type:'category',status:'uncertain'});await space.save();
        const category=await guild.channels.create({name:input.categoryName,type:ChannelType.GuildCategory,permissionOverwrites:overwrites,reason:`Equipo: solicitado por ${actorId}`});
        space.categoryId=category.id;space.channels.splice(0,space.channels.length);await space.save();
      }
      for(const row of input.channels) {
        let prior=space.channels.find(entry=>entry.key===row.key);
        if(row.channelId) {
          if(prior) {prior.channelId=row.channelId;prior.status='ready';}else space.channels.push({...row,status:'ready'});
          await space.save();continue;
        }
        if(prior?.status==='uncertain') throw workflowError(409,`Revisa Discord y selecciona el canal existente para ${row.name} antes de reintentar.`);
        if ([...ctx.channels.values()].some(channel=>channel !== null && channel.parentId===space!.categoryId && channel.name===row.name)) throw workflowError(409,'Ya existe un canal con ese nombre. Seleccionalo para reutilizarlo.');
        if(!prior) {space.channels.push({...row,channelId:undefined,status:'uncertain'});prior=space.channels.at(-1)!;}else prior.status='uncertain';
        await space.save();
        const channel=await guild.channels.create({name:row.name,type:row.type==='voice'?ChannelType.GuildVoice:ChannelType.GuildText,parent:space.categoryId!,permissionOverwrites:overwrites,reason:`Equipo: solicitado por ${actorId}`});
        prior.channelId=channel.id;prior.status='ready';await space.save();
      }
      await logEvent('team-space.prepared',`Espacio de equipo preparado por ${actorId}.`,guild.id);
      res.json({space});
    } finally {await TeamSpace.updateOne({_id:space._id},{$set:{locked:false}});}
  });
  router.post('/summary',async(req,res)=>{
    const input=object(req.body,['version']),ctx=res.locals.spaceContext as Awaited<ReturnType<typeof context>>;
    if(!ctx.canManage) throw workflowError(403,'Necesitas permisos para gestionar el espacio.');
    const space=await TeamSpace.findOne({guildId:req.managedGuild!.id});
    if(!space || space.version!==version(input.version) || space.locked) throw workflowError(409,'Actualiza el espacio antes de publicar.');
    if(space.summaryPending) throw workflowError(409,'El envio anterior no se confirmo. Revisa Discord antes de publicar de nuevo.');
    const destination=space.channels.find(row=>row.key==='notices')?.channelId,channel=destination?ctx.channels.get(destination):null;
    if(!channel || channel.type!==ChannelType.GuildText || !privateChannel(channel as GuildChannel,space.roleIds,ctx.me.id) || !channel.permissionsFor(ctx.me)?.has([P.ViewChannel,P.SendMessages,P.ReadMessageHistory]) || (ctx.actor && !channel.permissionsFor(ctx.actor)?.has(P.ViewChannel))) throw workflowError(403,'El canal de avisos no esta disponible o sus permisos privados cambiaron.');
    const locked=await TeamSpace.findOneAndUpdate({_id:space._id,locked:false,version:input.version},{$set:{locked:true},$inc:{version:1}},{new:true});if(!locked) throw workflowError(409,'Otra operacion esta en curso.');
    try {
      const filter={guildId:req.managedGuild!.id,state:{$ne:'closed'}};
      const [pending,unassigned]=await Promise.all([ModerationFollowup.countDocuments({...filter,reviewAt:{$lte:new Date()}}),ModerationFollowup.countDocuments({...filter,assigneeId:null})]);
      const payload={content:withLanguage(req.managedGuild!.preferredLocale,()=>t('team.summary',{pending,unassigned})),allowedMentions:{parse:[] as never[]}};
      if(space.summaryMessageId) await channel.messages.edit(space.summaryMessageId,payload);
      else { await TeamSpace.updateOne({_id:space._id},{$set:{summaryPending:true}});const message=await channel.send(payload);await TeamSpace.updateOne({_id:space._id},{$set:{summaryMessageId:message.id,summaryPending:false}}); }
      res.json({ok:true});
    } finally {await TeamSpace.updateOne({_id:space._id},{$set:{locked:false}});}
  });
  return router;
}
