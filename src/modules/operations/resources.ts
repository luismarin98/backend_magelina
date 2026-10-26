import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import type { ResourceUsage } from '../../types/contracts.js';

type Reader = (path: string) => Promise<string | null>;
const read: Reader = (path) => readFile(path, 'utf8').catch(() => null);
const positive = (value: string | null) => {
  const number = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 && number < 2 ** 60 ? number : null;
};
const counter = (value: string | null) => {
  const number = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
};
export function cpuQuota(value: string | null): number | null {
  const [quota, period] = value?.trim().split(/\s+/) ?? [];
  const q = positive(quota ?? null), p = positive(period ?? null);
  return q !== null && p !== null ? q / p : null;
}
function hierarchy(root: string, path: string) {
  if (!path.startsWith('/') || path.split('/').includes('..')) return [root];
  let directory = posix.resolve(root, `.${path}`);
  const paths = [directory];
  while (directory !== root) { directory = posix.dirname(directory); paths.push(directory); }
  return paths;
}
const minimum = (values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.min(...known) : null;
};
export async function readContainerResources(reader: Reader = read) {
  const membership = await reader('/proc/self/cgroup');
  const entries = (membership ?? '').trim().split('\n').map(line => line.split(':'));
  const unified = entries.find(entry => entry[0] === '0' && entry[1] === '');
  let memoryLimit: number | null = null, memoryUsed: number | null = null;
  let cpuLimit: number | null = null, cpuUsec: number | null = null;
  if (unified) {
    const paths = hierarchy('/sys/fs/cgroup', unified[2] ?? '/');
    // A namespaced mount exposes the container directly at the mount root.
    const samples = await Promise.all(paths.map(async path => {
      const [limit, used, quota, stat] = await Promise.all([
        reader(`${path}/memory.max`), reader(`${path}/memory.current`), reader(`${path}/cpu.max`), reader(`${path}/cpu.stat`),
      ]);
      return { limit: positive(limit), used: counter(used), quota: cpuQuota(quota), cpu: counter(stat?.match(/^usage_usec\s+(\d+)$/m)?.[1] ?? null) };
    }));
    memoryLimit = minimum(samples.map(sample => sample.limit));
    cpuLimit = minimum(samples.map(sample => sample.quota));
    memoryUsed = samples.find(sample => sample.used !== null)?.used ?? null;
    cpuUsec = samples.find(sample => sample.cpu !== null)?.cpu ?? null;
  } else if (membership) {
    const pathsFor = (controller: string, root: string) => hierarchy(root, entries.find(entry => entry[1]?.split(',').includes(controller))?.[2] ?? '/');
    const memory = await Promise.all(pathsFor('memory', '/sys/fs/cgroup/memory').map(async path => {
      const [limit, used] = await Promise.all([reader(`${path}/memory.limit_in_bytes`), reader(`${path}/memory.usage_in_bytes`)]);
      return { limit: positive(limit), used: counter(used) };
    }));
    const cpuRoot = (await reader('/sys/fs/cgroup/cpu/cpu.cfs_period_us')) !== null ? '/sys/fs/cgroup/cpu' : '/sys/fs/cgroup/cpu,cpuacct';
    const cpu = await Promise.all(pathsFor('cpu', cpuRoot).map(async path => {
      const [quota, period, usage] = await Promise.all([reader(`${path}/cpu.cfs_quota_us`), reader(`${path}/cpu.cfs_period_us`), reader(`${path}/cpuacct.usage`)]);
      return { limit: cpuQuota(`${quota} ${period}`), usage: counter(usage) };
    }));
    memoryLimit = minimum(memory.map(sample => sample.limit));
    memoryUsed = memory.find(sample => sample.used !== null)?.used ?? null;
    cpuLimit = minimum(cpu.map(sample => sample.limit));
    const nanos = cpu.find(sample => sample.usage !== null)?.usage ?? counter(await reader(`${pathsFor('cpuacct', '/sys/fs/cgroup/cpuacct')[0]}/cpuacct.usage`));
    cpuUsec = nanos === null ? null : nanos / 1000;
  }
  return { memoryLimit, memoryUsed, cpuLimit, cpuUsec };
}

export function resourceBudget(used: number | null, limit: number | null) {
  const percent = used !== null && limit !== null ? used / limit * 100 : null;
  return {
    used, limit, percent,
    remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
    recommendedLimit: limit === null ? null : limit * 0.8,
    safeRemaining: used !== null && limit !== null ? Math.max(0, limit * 0.8 - used) : null,
    status: percent === null ? 'unknown' as const : percent >= 90 ? 'critical' as const : percent >= 80 ? 'warning' as const : 'normal' as const,
  };
}

export function cpuCoresUsed(currentUsec: number, previousUsec: number, elapsedMs: number): number | null {
  return elapsedMs >= 1000 && elapsedMs <= 30000 && currentUsec >= previousUsec ? (currentUsec - previousUsec) / (elapsedMs * 1000) : null;
}

export function createResourceMonitor(reader: Reader = read) {
  let previous: { at: number; cpu: number; scope: string } | undefined;
  let cached: ResourceUsage | undefined;
  let pending: Promise<ResourceUsage> | undefined;
  let cachedAt = -Infinity;
  return function sample(): Promise<ResourceUsage> {
    if (pending) return pending;
    if (cached && performance.now() - cachedAt < 2000) return Promise.resolve(cached);
    pending = (async () => {
      const container = await readContainerResources(reader);
      const at = performance.now(), cpu = process.cpuUsage(), memory = process.memoryUsage();
      const scope = container.cpuUsec === null ? 'process' as const : 'container' as const;
      const cumulative = container.cpuUsec ?? cpu.user + cpu.system;
      const elapsed = previous && previous.scope === scope ? at - previous.at : null;
      const used = elapsed !== null && previous ? cpuCoresUsed(cumulative, previous.cpu, elapsed) : null;
      previous = { at, cpu: cumulative, scope };
      cached = {
        sampledAt: new Date().toISOString(), intervalMs: elapsed,
        cpu: { ...resourceBudget(used, container.cpuLimit), scope },
        memory: { ...resourceBudget(container.memoryUsed ?? memory.rss, container.memoryLimit), scope: container.memoryUsed === null ? 'process' : 'container', processRss: memory.rss, heapUsed: memory.heapUsed },
      };
      cachedAt = at;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
export const getResourceUsage = createResourceMonitor();
