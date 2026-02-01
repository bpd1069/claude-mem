/**
 * GitLfsSync Integration Tests
 *
 * Tests for the git-lfs export functionality.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { GitLfsSync, type GitLfsSyncStatus } from '../../src/services/sync/GitLfsSync.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';

describe('GitLfsSync', () => {
  const testDir = path.join(os.tmpdir(), 'claude-mem-test-git-lfs');

  beforeAll(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Clean test directory before each test
    const exportDir = path.join(testDir, 'export');
    if (existsSync(exportDir)) {
      try {
        rmSync(exportDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  describe('initialization', () => {
    it('should create GitLfsSync instance', () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export')
      });
      expect(gitLfs).toBeDefined();
    });

    it('should detect git-lfs installation status', () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export')
      });
      // This will be true or false depending on system
      const isInstalled = gitLfs.isLfsInstalled();
      expect(typeof isInstalled).toBe('boolean');
    });
  });

  describe('getStatus', () => {
    it('should return status for uninitialized repo', async () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export')
      });

      const status = await gitLfs.getStatus();

      expect(status).toBeDefined();
      expect(status.initialized).toBe(false);
      expect(status.hasRemote).toBe(false);
      expect(status.fileCount).toBe(0);
      expect(status.totalSize).toBe(0);
    });
  });

  describe('getExportDir', () => {
    it('should return configured export directory', () => {
      const exportDir = path.join(testDir, 'export');
      const gitLfs = new GitLfsSync({ exportDir });

      expect(gitLfs.getExportDir()).toBe(exportDir);
    });
  });

  describe('shouldAutoPush', () => {
    it('should return false when autoPush is disabled', () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export'),
        autoPush: false
      });

      const lastActivity = new Date(Date.now() - 600000); // 10 minutes ago
      expect(gitLfs.shouldAutoPush(lastActivity)).toBe(false);
    });

    it('should return false when no pending changes', () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export'),
        autoPush: true,
        idlePushSeconds: 60
      });

      const lastActivity = new Date(Date.now() - 600000); // 10 minutes ago
      // No changes have been made, so should return false
      expect(gitLfs.shouldAutoPush(lastActivity)).toBe(false);
    });
  });

  describe('GitLfsSyncStatus interface', () => {
    it('should have all required status fields', async () => {
      const gitLfs = new GitLfsSync({
        exportDir: path.join(testDir, 'export')
      });

      const status: GitLfsSyncStatus = await gitLfs.getStatus();

      // Verify all required fields exist
      expect(typeof status.initialized).toBe('boolean');
      expect(typeof status.hasRemote).toBe('boolean');
      expect(typeof status.remoteName).toBe('string');
      expect(typeof status.pendingChanges).toBe('boolean');
      expect(typeof status.lfsInstalled).toBe('boolean');
      expect(typeof status.fileCount).toBe('number');
      expect(typeof status.totalSize).toBe('number');

      // Optional fields
      if (status.remoteUrl !== null) {
        expect(typeof status.remoteUrl).toBe('string');
      }
      if (status.lastPush !== null) {
        expect(status.lastPush instanceof Date).toBe(true);
      }
    });
  });
});

describe('GitLfsSync configuration', () => {
  it('should use default values when not configured', () => {
    const gitLfs = new GitLfsSync();

    // Should have a valid export directory
    const exportDir = gitLfs.getExportDir();
    expect(exportDir).toContain('.claude-mem');
    expect(exportDir).toContain('export');
  });

  it('should accept custom configuration', () => {
    const customDir = path.join(os.tmpdir(), 'custom-export');
    const gitLfs = new GitLfsSync({
      exportDir: customDir,
      remote: 'upstream',
      remoteUrl: 'https://example.com/repo.git',
      autoPush: true,
      idlePushSeconds: 120
    });

    expect(gitLfs.getExportDir()).toBe(customDir);
  });
});
