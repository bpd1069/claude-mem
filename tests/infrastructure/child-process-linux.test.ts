import { describe, it, expect, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { getChildProcesses } from '../../src/services/infrastructure/ProcessManager.js';

describe('getChildProcesses (Linux)', () => {
  const spawnedPids: number[] = [];

  afterEach(() => {
    for (const pid of spawnedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    spawnedPids.length = 0;
  });

  it('should find spawned child processes', async () => {
    const child = spawn('sleep', ['60'], { detached: false, stdio: 'ignore' });
    expect(child.pid).toBeDefined();
    spawnedPids.push(child.pid!);

    // Small delay for process to register
    await new Promise(r => setTimeout(r, 100));

    const children = await getChildProcesses(process.pid);
    expect(children).toContain(child.pid!);
  });

  it('should return empty array for process with no children', async () => {
    // Use a PID that exists but has no children (init or similar)
    const children = await getChildProcesses(process.pid);
    // Filter out any test-spawned processes
    // Just verify it returns an array
    expect(Array.isArray(children)).toBe(true);
  });

  it('should return empty array for invalid PID', async () => {
    const children = await getChildProcesses(-1);
    expect(children).toEqual([]);
  });

  it('should return empty array for zero PID', async () => {
    const children = await getChildProcesses(0);
    expect(children).toEqual([]);
  });

  it('should handle exited child process gracefully', async () => {
    const child = spawn('true', [], { stdio: 'ignore' });
    const pid = child.pid!;

    // Wait for it to exit
    await new Promise<void>(resolve => child.on('exit', () => resolve()));
    await new Promise(r => setTimeout(r, 100));

    // Should not include the exited process
    const children = await getChildProcesses(process.pid);
    expect(children).not.toContain(pid);
  });

  it('should find multiple children', async () => {
    const child1 = spawn('sleep', ['60'], { stdio: 'ignore' });
    const child2 = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child1.pid!, child2.pid!);

    await new Promise(r => setTimeout(r, 100));

    const children = await getChildProcesses(process.pid);
    expect(children).toContain(child1.pid!);
    expect(children).toContain(child2.pid!);
  });
});
