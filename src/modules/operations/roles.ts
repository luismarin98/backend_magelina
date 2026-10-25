import type { Config } from '../../config/env.js';
import { getGlobalRole } from '../../auth/discord.js';
import { getControls } from './service.js';
export async function effectiveRole(id: string, config: Pick<Config, 'ownerIds' | 'operatorIds'>) {
  const controls = await getControls();
  return getGlobalRole(id, { ownerIds: config.ownerIds, operatorIds: controls.version === 0 ? config.operatorIds : controls.operatorIds });
}
