import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuQuota, cpuCoresUsed, readContainerResources, resourceBudget, createResourceMonitor } from '../src/modules/operations/resources.js';

const fixture = (files: Record<string, string>) => async (path: string) => files[path] ?? null;
test('CPU uses elapsed wall time and quota rather than the host CPU count', () => {
  const used = cpuCoresUsed(2_500_000, 0, 5000);
  assert.equal(used, 0.5);
  assert.equal(resourceBudget(used, 0.5).percent, 100);
  assert.equal(cpuCoresUsed(500, 1000, 5000), null);
  assert.equal(cpuCoresUsed(500, 0, 0), null);
  assert.equal(cpuCoresUsed(500, 0, 60000), null);
});
test('CPU quotas and memory budgets preserve unknown limits and overages', () => {
  assert.equal(cpuQuota('50000 100000'), 0.5);
  for (const value of ['max 100000', '-1 100000', '200 0', 'bad', '']) assert.equal(cpuQuota(value), null);
  assert.equal(resourceBudget(90, 100).status, 'critical');
  assert.equal(resourceBudget(80, 100).status, 'warning');
  assert.equal(resourceBudget(79, 100).status, 'normal');
  assert.equal(resourceBudget(120, 100).percent, 120);
  assert.equal(resourceBudget(120, 100).remaining, 0);
  assert.equal(resourceBudget(70, 100).safeRemaining, 10);
  assert.equal(resourceBudget(70, null).percent, null);
});
test('cgroup v2 measures container usage and respects stricter ancestor quotas', async () => {
  const values = await readContainerResources(fixture({
    '/proc/self/cgroup': '0::/service',
    '/sys/fs/cgroup/service/memory.max': 'max',
    '/sys/fs/cgroup/service/memory.current': '100',
    '/sys/fs/cgroup/service/cpu.max': '100000 100000',
    '/sys/fs/cgroup/service/cpu.stat': 'usage_usec 1000\nuser_usec 700\n',
    '/sys/fs/cgroup/memory.max': '512',
    '/sys/fs/cgroup/memory.current': '200',
    '/sys/fs/cgroup/cpu.max': '50000 100000',
  }));
  assert.deepEqual(values, { memoryLimit: 512, memoryUsed: 100, cpuLimit: 0.5, cpuUsec: 1000 });
});
test('namespaced cgroup mounts are read at the root when the membership path is absent', async () => {
  const values = await readContainerResources(fixture({
    '/proc/self/cgroup': '0::/service',
    '/sys/fs/cgroup/memory.max': '536870912',
    '/sys/fs/cgroup/memory.current': '1234',
    '/sys/fs/cgroup/cpu.max': 'max 100000',
    '/sys/fs/cgroup/cpu.stat': 'usage_usec 5000',
  }));
  assert.equal(values.memoryLimit, 536870912);
  assert.equal(values.memoryUsed, 1234);
  assert.equal(values.cpuLimit, null);
});
test('cgroup v1 supports separate controllers and rejects the unlimited memory sentinel', async () => {
  const values = await readContainerResources(fixture({
    '/proc/self/cgroup': '5:memory:/\n4:cpu,cpuacct:/',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes': '300',
    '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us': '50000',
    '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us': '100000',
    '/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage': '1234000',
  }));
  assert.deepEqual(values, { memoryLimit: null, memoryUsed: 300, cpuLimit: 0.5, cpuUsec: 1234 });
});
test('unavailable metrics fall back to process data without inventing an allocation', async () => {
  const monitor = createResourceMonitor(fixture({}));
  const sample = await monitor();
  assert.equal(sample.cpu.used, null);
  assert.equal(sample.cpu.limit, null);
  assert.equal(sample.memory.limit, null);
  assert.equal(sample.memory.scope, 'process');
  assert.ok(sample.memory.processRss > 0);
  assert.equal(await monitor(), sample);
});
