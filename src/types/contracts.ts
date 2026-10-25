/** Contratos JSON locales de este proyecto. Las fechas de la API son cadenas ISO, no Date. */
export type GlobalRole = 'owner' | 'operator' | 'member';
export type WorkStatus = 'submitted' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
export type KnowledgeAction = 'created' | 'updated' | 'reviewed' | 'archived' | 'restored';
export interface DiscordImage { url: string; staticUrl: string }
export interface BotIdentity { id: string; name: string; avatar: DiscordImage | null; avatarDecorationUrl: string | null }
export interface BotIdentityResponse { bot: BotIdentity | null }
export interface SessionUser { id: string; username: string; name: string; avatar?: DiscordImage | null; avatarDecorationUrl?: string | null }
export interface SessionResponse { user: SessionUser; role: GlobalRole }
export interface GuildSummary { id: string; name: string; icon?: DiscordImage | null; banner?: DiscordImage | null }
export interface ManagedGuild extends GuildSummary { botInstalled: boolean }
export interface GuildsResponse { guilds: ManagedGuild[] }
export type RoleKind = 'administrator' | 'moderator' | 'coordinator' | 'collaborator' | 'reader' | 'custom';
export interface RoleTemplate { id: RoleKind; name: string; permissions: string[]; capabilities: Capability[] }
export interface GuildRole { id: string; name: string; color: string; managed: boolean; kind?: RoleKind; bindingVersion?: number; editable?: boolean }
export interface RolesResponse { guild: GuildSummary; roles: GuildRole[]; templates?: RoleTemplate[]; permissionOptions?: string[]; canCreate?: boolean; canAssignInternal?: boolean; policyVersion?: number }
export interface AdminOverview {
  bot: { ready: boolean; name: string | null; uptimeMs: number; avatar?: DiscordImage | null; avatarDecorationUrl?: string | null };
  database: { ready: boolean };
  guildCount: number;
  guilds: GuildSummary[];
}
export interface WorkItemDto {
  _id: string; guildId: string; sourceChannelId: string; sourceMessageId: string;
  createdBy: string; title: string; status: WorkStatus; assigneeId: string | null;
  version: number; projectId: string | null; createdAt: string; updatedAt: string;
  history: { actorId: string; status: WorkStatus; at: string; note?: string }[];
}
export type WorkChange = { version: number } & (
  { status: 'accepted'; assigneeId: string } |
  { status: Exclude<WorkStatus, 'accepted'>; assigneeId?: never }
);
export interface WorkItemsResponse { items: WorkItemDto[]; nextCursor: string | null }
export interface WorkChangeResponse { item: WorkItemDto; notificationDelivered: boolean; notificationStatus: NotificationStatus }
export interface ArticleFields { title: string; content: string; tags: string[] }
export interface KnowledgeArticleDto extends ArticleFields {
  _id: string; guildId: string; sourceItemId: string; createdBy: string; archived: boolean;
  reviewedAt: string; reviewDueAt: string; version: number; createdAt: string; updatedAt: string;
  history: { actorId: string; action: KnowledgeAction; at: string }[];
}
export interface ArticlesResponse { articles: KnowledgeArticleDto[]; nextCursor: string | null }
export interface ArticleResponse { article: KnowledgeArticleDto }
export interface CreateArticleInput extends ArticleFields { sourceItemId: string }
export type ArticleChange = { version: number } & (
  ({ action: 'updated' } & ArticleFields) |
  { action: Exclude<KnowledgeAction, 'created' | 'updated'> }
);

export type ModuleKey = 'workflow' | 'knowledge' | 'projects' | 'collaboration' | 'automations' | 'audit' | 'music';
export interface GuildSettingsValues {
  modules: Record<ModuleKey, boolean>;
  notifications: { enabled: boolean; channelId: string | null };
  knowledge: { reviewDays: number };
}
export interface GuildSettingsDto extends GuildSettingsValues {
  guildId: string; version: number;
  history: { actorId: string; at: string; changes: string[]; before: GuildSettingsValues; after: GuildSettingsValues }[];
}
export interface GuildSettingsInput extends GuildSettingsValues { version: number }
export interface SettingsResponse { settings: GuildSettingsDto }
export interface NotificationChannel { id: string; name: string; canSend: boolean }
export interface SettingsChannelsResponse { channels: NotificationChannel[] }
export type NotificationStatus = 'delivered' | 'disabled' | 'failed';

export type Capability = 'workflow.read' | 'workflow.manage' | 'knowledge.read' | 'knowledge.manage' | 'projects.read' | 'projects.manage' | 'collaboration.read' | 'collaboration.manage' | 'automations.read' | 'automations.manage' | 'audit.read' | 'music.read' | 'music.request' | 'music.manage';
export type RoleGrants = Record<Capability, string[]>;
export interface GuildAccess { canConfigure: boolean; canManageRoles?: boolean; canModerate?: boolean; capabilities: Capability[]; source?: 'bot-owner' | 'guild-owner' | 'discord-manager' | 'delegated' }
export interface AccessResponse extends GuildAccess { modules: Record<ModuleKey, boolean>; reviewDays: number }
export interface PermissionPolicy {
  guildId: string; version: number; grants: RoleGrants;
  history: { actorId: string; at: string; before: RoleGrants; after: RoleGrants }[];
}
export interface PermissionsResponse { policy: PermissionPolicy }
export interface PermissionInput { version: number; grants: RoleGrants }

export interface ProjectFields { title: string; description: string; objectives: string[]; dueAt: string | null }
export interface ProjectDto extends ProjectFields { _id: string; guildId: string; archived: boolean; version: number; completedObjectives: number[]; taskCount: number; completedTasks: number; history: { actorId: string; action: string; at: string }[] }
export interface ProjectsResponse { projects: ProjectDto[]; nextCursor: string | null }
export interface ProjectResponse { project: ProjectDto }
export interface ProfileFields { bio: string; offers: string[]; seeks: string[]; available: boolean }
export interface ProfileDto extends ProfileFields { userId: string; version: number }
export interface MentorshipDto { _id: string; mentorId: string; learnerId: string; goal: string; status: 'pending' | 'active' | 'completed' | 'cancelled'; acceptedBy: string[]; version: number; history: { actorId: string; action: string; at: string }[] }
export interface CollaborationResponse { profiles: ProfileDto[]; mentorships: MentorshipDto[]; nextCursor: string | null; nextMentorshipCursor: string | null }
export type AutomationTrigger = 'task.accepted' | 'task.completed' | 'knowledge.review_due' | 'project.deadline';
export interface AutomationRuleDto { _id: string; title: string; trigger: AutomationTrigger; channelId: string; delayMinutes: number; enabled: boolean; version: number; history: { actorId: string; at: string }[] }
export interface AutomationJobDto { _id: string; guildId: string; ruleId: string; resourceId: string; status: 'pending' | 'processing' | 'delivered' | 'failed' | 'cancelled'; dueAt: string; attempts: number; error: string | null }
export interface AutomationsResponse { rules: AutomationRuleDto[]; jobs: AutomationJobDto[]; nextCursor: string | null; nextJobCursor: string | null }
export interface AuditEntryDto { id: string; actorId: string | null; action: number; targetId: string | null; reason: string | null; at: string }
export interface AuditResponse { entries: AuditEntryDto[]; nextCursor: string | null }
export interface BotControlValues { operatorIds: string[]; maintenance: boolean; disabledModules: ModuleKey[]; blockedGuildIds: string[]; requestsPerMinute: number; jobsPerTick: number }
export interface BotControlDto extends BotControlValues { version: number; history: { actorId: string; at: string; before: BotControlValues; after: BotControlValues }[] }
export interface OperationsResponse { controls: BotControlDto; jobs: AutomationJobDto[]; events: { _id: string; kind: string; guildId: string | null; at: string; message: string }[]; nextJobCursor: string | null; nextEventCursor: string | null }

export type ModerationAction = 'warning' | 'timeout' | 'untimeout' | 'kick' | 'ban';
export interface ModerationMember {
  id: string; name: string; username: string; avatar: DiscordImage | null; bot: boolean;
  joinedAt: string | null; createdAt: string; timeoutUntil: string | null;
  roles: { id: string; name: string; color: string }[];
  allowedActions: ModerationAction[];
}
export interface ModerationCase {
  _id: string; guildId: string; actorId: string; targetId: string; action: ModerationAction;
  reason: string; evidence: string[]; durationMinutes: number | null;
  status: 'pending' | 'applied' | 'failed' | 'uncertain'; createdAt: string;
}
export interface ModerationCasesResponse { cases: ModerationCase[]; nextCursor: string | null }
export interface ModerationMembersResponse { members: ModerationMember[]; nextCursor: string | null }
export interface ModerationCaseResponse { item: ModerationCase; warning?: string }

export interface MusicTrack { id: string; title: string; artist: string; durationSeconds: number; permalink: string; artworkUrl: string | null }
export interface MusicQueueEntry { id: string; track: MusicTrack; requestedBy: string }
export interface MusicState {
  version: number; channelId: string | null; status: 'disconnected' | 'idle' | 'buffering' | 'playing' | 'paused';
  current: MusicQueueEntry | null; queue: MusicQueueEntry[]; volume: number; error: string | null; positionMs?: number; observedAt?: string;
}
export interface MusicResponse { player: MusicState; enabled: boolean; youtubeEnabled?: boolean; channels: { id: string; name: string; canConnect: boolean }[]; canRequest: boolean; canManage: boolean; listeners?: number }
export interface MusicSearchResponse { tracks: MusicTrack[] }
