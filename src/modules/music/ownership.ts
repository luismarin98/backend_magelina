import type { MusicState } from '../../types/contracts.js';

/** Ownership grants control over one entry, never over the shared session. */
export function ownsMusicControl(player: MusicState, actorId: string, action: string, value?: unknown) {
  if (action === 'remove') return player.queue.some(entry => entry.id === value && entry.requestedBy === actorId);
  return ['pause', 'resume', 'skip'].includes(action) && player.current?.requestedBy === actorId;
}
