/**
 * Git-sync CLI Command
 *
 * CLI commands for managing git-lfs vector database exports.
 *
 * Usage:
 *   claude-mem git-sync status  - Show export repository status
 *   claude-mem git-sync push    - Export and push to remote
 *   claude-mem git-sync pull    - Pull from remote
 *   claude-mem git-sync init    - Initialize export repository
 */

import { GitLfsSync } from '../services/sync/GitLfsSync.js';
import { SqliteVecBackend } from '../services/vector/SqliteVecBackend.js';
import { SettingsDefaultsManager } from '../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../shared/paths.js';
import path from 'path';
import os from 'os';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function gitSyncCommand(subcommand: string, args: string[]): Promise<void> {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const vectorBackend = (settings as any).VECTOR_BACKEND || 'chroma';

  if (vectorBackend !== 'sqlite-vec') {
    console.error('Error: git-sync requires VECTOR_BACKEND to be set to "sqlite-vec"');
    console.error(`Current backend: ${vectorBackend}`);
    console.error('\nTo enable, update ~/.claude-mem/settings.json:');
    console.error('  "VECTOR_BACKEND": "sqlite-vec"');
    process.exit(1);
  }

  const gitLfs = new GitLfsSync();

  switch (subcommand) {
    case 'status':
      await showStatus(gitLfs);
      break;

    case 'push':
      await pushCommand(gitLfs, args);
      break;

    case 'pull':
      await pullCommand(gitLfs);
      break;

    case 'init':
      await initCommand(gitLfs, args);
      break;

    default:
      console.error(`Unknown git-sync subcommand: ${subcommand}`);
      console.error('\nAvailable commands:');
      console.error('  git-sync status  - Show export repository status');
      console.error('  git-sync push    - Export and push to remote');
      console.error('  git-sync pull    - Pull from remote');
      console.error('  git-sync init    - Initialize export repository');
      process.exit(1);
  }
}

async function showStatus(gitLfs: GitLfsSync): Promise<void> {
  const status = await gitLfs.getStatus();

  console.log('\n=== Git-LFS Export Status ===\n');

  console.log(`Repository:     ${status.initialized ? 'Initialized' : 'Not initialized'}`);
  console.log(`Export path:    ${gitLfs.getExportDir()}`);
  console.log(`Git-LFS:        ${status.lfsInstalled ? 'Installed' : 'NOT INSTALLED'}`);

  if (status.initialized) {
    console.log(`Remote:         ${status.hasRemote ? `${status.remoteName} (${status.remoteUrl})` : 'Not configured'}`);
    console.log(`LFS files:      ${status.fileCount}`);
    console.log(`Total size:     ${formatBytes(status.totalSize)}`);
    console.log(`Pending:        ${status.pendingChanges ? 'Yes (uncommitted changes)' : 'No'}`);

    if (status.lastPush) {
      console.log(`Last push:      ${status.lastPush.toISOString()}`);
    }
  }

  // Show settings
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  console.log('\n--- Settings ---');
  console.log(`GIT_LFS_ENABLED:         ${settings.GIT_LFS_ENABLED}`);
  console.log(`GIT_LFS_AUTO_PUSH:       ${settings.GIT_LFS_AUTO_PUSH}`);
  console.log(`GIT_LFS_REMOTE:          ${settings.GIT_LFS_REMOTE}`);
  console.log(`GIT_LFS_REMOTE_URL:      ${settings.GIT_LFS_REMOTE_URL || '(not set)'}`);
  console.log(`GIT_LFS_IDLE_PUSH_SECONDS: ${settings.GIT_LFS_IDLE_PUSH_SECONDS}`);

  if (!status.lfsInstalled) {
    console.log('\n⚠️  Warning: git-lfs is not installed.');
    console.log('   Install it with: brew install git-lfs (macOS)');
    console.log('                    apt install git-lfs (Ubuntu/Debian)');
  }

  if (!status.initialized) {
    console.log('\n💡 Run "claude-mem git-sync init" to set up the export repository.');
  }

  console.log('');
}

async function pushCommand(gitLfs: GitLfsSync, args: string[]): Promise<void> {
  console.log('Exporting vector database...');

  // Initialize if needed
  await gitLfs.initialize();

  // Get the sqlite-vec database path
  const dataDir = path.join(os.homedir(), '.claude-mem');
  const vectorsDbPath = path.join(dataDir, 'vectors.db');

  // Check if vectors.db exists
  const { existsSync } = await import('fs');
  if (!existsSync(vectorsDbPath)) {
    console.error(`Error: Vector database not found at ${vectorsDbPath}`);
    console.error('\nMake sure sqlite-vec backend is active and has data.');
    process.exit(1);
  }

  // Export the database
  await gitLfs.exportDatabase(vectorsDbPath, 'vectors.db');
  console.log('Database exported.');

  // Optionally export full database
  if (args.includes('--full')) {
    const mainDbPath = path.join(dataDir, 'claude-mem.db');
    if (existsSync(mainDbPath)) {
      await gitLfs.exportDatabase(mainDbPath, 'full-export.db');
      console.log('Full database exported.');
    }
  }

  // Commit changes
  const committed = await gitLfs.commit();
  if (committed) {
    console.log('Changes committed.');
  } else {
    console.log('No changes to commit.');
  }

  // Check if remote is configured
  const status = await gitLfs.getStatus();
  if (!status.hasRemote) {
    console.log('\n⚠️  No remote configured. Changes are committed locally.');
    console.log('   Configure remote in settings or run:');
    console.log('   claude-mem git-sync init --remote <url>');
    return;
  }

  // Push to remote
  console.log(`Pushing to ${status.remoteName}...`);
  const pushed = await gitLfs.push();
  if (pushed) {
    console.log('✓ Push successful!');
  } else {
    console.error('✗ Push failed. Check git-lfs logs for details.');
    process.exit(1);
  }
}

async function pullCommand(gitLfs: GitLfsSync): Promise<void> {
  const status = await gitLfs.getStatus();

  if (!status.initialized) {
    console.error('Error: Export repository not initialized.');
    console.error('Run "claude-mem git-sync init" first.');
    process.exit(1);
  }

  if (!status.hasRemote) {
    console.error('Error: No remote configured.');
    console.error('Configure GIT_LFS_REMOTE_URL in settings or run:');
    console.error('  claude-mem git-sync init --remote <url>');
    process.exit(1);
  }

  console.log(`Pulling from ${status.remoteName}...`);
  const pulled = await gitLfs.pull();

  if (pulled) {
    console.log('✓ Pull successful!');
    console.log(`\nExported files are in: ${gitLfs.getExportDir()}`);
    console.log('\nTo import the vectors database:');
    console.log(`  cp ${gitLfs.getExportDir()}/vectors.db ~/.claude-mem/vectors.db`);
  } else {
    console.error('✗ Pull failed. Check git-lfs logs for details.');
    process.exit(1);
  }
}

async function initCommand(gitLfs: GitLfsSync, args: string[]): Promise<void> {
  // Check for --remote flag
  const remoteIndex = args.indexOf('--remote');
  if (remoteIndex !== -1 && args[remoteIndex + 1]) {
    const remoteUrl = args[remoteIndex + 1];
    console.log(`Configuring remote URL: ${remoteUrl}`);

    // Update settings
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    (settings as any).GIT_LFS_REMOTE_URL = remoteUrl;

    // Save settings
    const { writeFileSync } = await import('fs');
    writeFileSync(USER_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    console.log('Settings updated.');

    // Reinitialize with new settings
    const newGitLfs = new GitLfsSync();
    await newGitLfs.initialize();
    console.log('✓ Export repository initialized with remote.');
    return;
  }

  // Basic initialization
  console.log('Initializing export repository...');
  await gitLfs.initialize();

  const status = await gitLfs.getStatus();
  console.log(`✓ Export repository initialized at: ${gitLfs.getExportDir()}`);

  if (!status.hasRemote) {
    console.log('\n💡 To configure a remote, run:');
    console.log('   claude-mem git-sync init --remote <git-url>');
    console.log('\n   Or update ~/.claude-mem/settings.json:');
    console.log('   "GIT_LFS_REMOTE_URL": "https://github.com/user/repo.git"');
  }
}
