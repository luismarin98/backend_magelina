import type { MusicProvider } from './audius.js';
import { trackId } from './audius.js';
import type { YouTubeExtractor } from './youtube.js';
import { youtubeId, configuredYouTube } from './youtube.js';
import { openAudio } from './network.js';
import { workflowError } from '../workflow/rules.js';

export function musicTrackId(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('youtube:')) return `youtube:${youtubeId(value)}`;
  return trackId(value);
}
export class MusicSources implements MusicProvider {
  constructor(private readonly audius: MusicProvider, public youtube: YouTubeExtractor | null) {}
  enableYouTube() {
    this.youtube ??= configuredYouTube(true);
  }
  search(query: string, source: 'audius' | 'youtube' = 'audius') {
    if (source === 'audius') return this.audius.search(query);
    if (!this.youtube) throw workflowError(503, 'La fuente experimental de YouTube no está habilitada.');
    return this.youtube.search(query);
  }
  track(id: string) {
    if (!id.startsWith('youtube:')) return this.audius.track(id);
    if (!this.youtube) throw workflowError(503, 'La fuente experimental de YouTube no está habilitada.');
    return this.youtube.track(id);
  }
  streamUrl(id: string) {
    if (id.startsWith('youtube:')) throw workflowError(400, 'YouTube se reproduce mediante el extractor.');
    return this.audius.streamUrl(id);
  }
  openStream(id: string, signal: AbortSignal) {
    if (!id.startsWith('youtube:')) return openAudio(this.audius.streamUrl(id), signal);
    if (!this.youtube) throw workflowError(503, 'La fuente experimental de YouTube no está habilitada.');
    return this.youtube.open(id, signal);
  }
}
