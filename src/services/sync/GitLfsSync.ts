/**
 * GitLfsSync Service
 *
 * Manages git-lfs export of vector databases for versioning and sharing.
 * Supports pushing sqlite-vec databases to remote git repositories.
 *
 * Export structure:
 * ~/.claude-mem/export/
 * ├── .git/
 * ├── .gitattributes      # LFS tracking rules
 * ├── vectors.db          # sqlite-vec database (LFS tracked)
 * ├── metadata.json       # Export metadata
 * └── README.md           # Auto-generated
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';

export interface GitLfsSyncConfig {
  exportDir: string;
  remote: string;
  remoteUrl?: string;
  autoPush: boolean;
  idlePushSeconds: number;
}

export interface GitLfsSyncStatus {
  initialized: boolean;
  hasRemote: boolean;
  remoteName: string;
  remoteUrl: string | null;
  lastPush: Date | null;
  pendingChanges: boolean;
  lfsInstalled: boolean;
  fileCount: number;
  totalSize: number;
}

export class GitLfsSync {
  private exportDir: string;
  private remote: string;
  private remoteUrl: string | null;
  private autoPush: boolean;
  private idlePushSeconds: number;
  private lastPushTime: Date | null = null;
  private pendingChanges: boolean = false;

  constructor(config?: Partial<GitLfsSyncConfig>) {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const dataDir = settings.CLAUDE_MEM_DATA_DIR || path.join(os.homedir(), '.claude-mem');
    this.exportDir = config?.exportDir || path.join(dataDir, 'export');
    this.remote = config?.remote || settings.GIT_LFS_REMOTE || 'origin';
    this.remoteUrl = config?.remoteUrl || settings.GIT_LFS_REMOTE_URL || null;
    this.autoPush = config?.autoPush ?? settings.GIT_LFS_AUTO_PUSH === 'true';
    this.idlePushSeconds = config?.idlePushSeconds ?? parseInt(settings.GIT_LFS_IDLE_PUSH_SECONDS || '300', 10);
  }

  /**
   * Check if git-lfs is installed on the system
   */
  isLfsInstalled(): boolean {
    try {
      const result = spawnSync('git', ['lfs', 'version'], { encoding: 'utf-8' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the export repository
   */
  async initialize(): Promise<void> {
    // Check git-lfs availability
    if (!this.isLfsInstalled()) {
      logger.warn('GIT_LFS', 'git-lfs is not installed, some features will be disabled');
    }

    // Create export directory
    if (!existsSync(this.exportDir)) {
      mkdirSync(this.exportDir, { recursive: true });
    }

    const gitDir = path.join(this.exportDir, '.git');
    if (!existsSync(gitDir)) {
      // Initialize new git repository
      await this.runGit(['init']);

      // Configure git-lfs tracking
      await this.runGit(['lfs', 'install', '--local']);

      // Create .gitattributes for LFS tracking
      const gitattributes = `# Git LFS tracking for claude-mem exports
*.db filter=lfs diff=lfs merge=lfs -text
*.sqlite filter=lfs diff=lfs merge=lfs -text
*.sqlite3 filter=lfs diff=lfs merge=lfs -text
`;
      writeFileSync(path.join(this.exportDir, '.gitattributes'), gitattributes);

      // Create README
      this.updateReadme();

      // Initial commit
      await this.runGit(['add', '.gitattributes', 'README.md']);
      await this.runGit(['commit', '-m', 'Initial claude-mem export repository']);

      logger.info('GIT_LFS', 'Export repository initialized', { path: this.exportDir });
    }

    // Configure remote if provided
    if (this.remoteUrl) {
      await this.configureRemote();
    }
  }

  /**
   * Configure git remote
   */
  private async configureRemote(): Promise<void> {
    if (!this.remoteUrl) return;

    try {
      // Check if remote exists
      const result = await this.runGit(['remote', 'get-url', this.remote]);
      // Remote exists, update if different
      if (result.trim() !== this.remoteUrl) {
        await this.runGit(['remote', 'set-url', this.remote, this.remoteUrl]);
        logger.info('GIT_LFS', 'Remote URL updated', { remote: this.remote, url: this.remoteUrl });
      }
    } catch {
      // Remote doesn't exist, add it
      await this.runGit(['remote', 'add', this.remote, this.remoteUrl]);
      logger.info('GIT_LFS', 'Remote added', { remote: this.remote, url: this.remoteUrl });
    }
  }

  /**
   * Run a git command in the export directory
   */
  private runGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.exportDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Git command failed: git ${args.join(' ')}\n${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Update the README file with current stats
   */
  private updateReadme(): void {
    const readme = `# Claude-mem Vector Database Export

This repository contains exported vector embeddings from claude-mem.

## Contents

- \`vectors.db\` - sqlite-vec database with semantic embeddings
- \`metadata.json\` - Export metadata and timestamps
- \`full-export.db\` - Full database export (if enabled)

## Usage

To import this database into another claude-mem installation:

\`\`\`bash
# Clone this repository
git lfs clone <this-repo-url>

# Copy the vector database
cp vectors.db ~/.claude-mem/vectors.db

# Or use the import command
claude-mem import --vectors ./vectors.db
\`\`\`

## Last Updated

${new Date().toISOString()}

---
*Generated by claude-mem git-lfs export*
`;
    writeFileSync(path.join(this.exportDir, 'README.md'), readme);
  }

  /**
   * Copy a database file to the export directory
   */
  async exportDatabase(sourcePath: string, destName: string = 'vectors.db'): Promise<void> {
    if (!existsSync(sourcePath)) {
      throw new Error(`Source database not found: ${sourcePath}`);
    }

    await this.initialize();

    const destPath = path.join(this.exportDir, destName);
    copyFileSync(sourcePath, destPath);

    // Update metadata
    const metadata = {
      exportedAt: new Date().toISOString(),
      sourceFile: path.basename(sourcePath),
      fileSize: statSync(destPath).size,
      hostname: os.hostname(),
      platform: os.platform()
    };
    writeFileSync(
      path.join(this.exportDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    this.updateReadme();
    this.pendingChanges = true;

    logger.info('GIT_LFS', 'Database exported', {
      source: sourcePath,
      dest: destPath,
      size: metadata.fileSize
    });
  }

  /**
   * Commit pending changes
   */
  async commit(message?: string): Promise<boolean> {
    try {
      // Stage all changes
      await this.runGit(['add', '-A']);

      // Check if there are changes to commit
      const status = await this.runGit(['status', '--porcelain']);
      if (!status.trim()) {
        logger.debug('GIT_LFS', 'No changes to commit');
        this.pendingChanges = false;
        return false;
      }

      // Commit
      const commitMessage = message || `claude-mem export ${new Date().toISOString()}`;
      await this.runGit(['commit', '-m', commitMessage]);

      this.pendingChanges = false;
      logger.info('GIT_LFS', 'Changes committed', { message: commitMessage });
      return true;
    } catch (error) {
      logger.error('GIT_LFS', 'Commit failed', {}, error as Error);
      return false;
    }
  }

  /**
   * Push to remote repository
   */
  async push(): Promise<boolean> {
    try {
      // Check if remote is configured
      const remotes = await this.runGit(['remote']);
      if (!remotes.includes(this.remote)) {
        logger.warn('GIT_LFS', 'Remote not configured', { remote: this.remote });
        return false;
      }

      // Commit any pending changes first
      await this.commit();

      // Push with LFS
      await this.runGit(['push', this.remote, 'main']);

      this.lastPushTime = new Date();
      logger.info('GIT_LFS', 'Pushed to remote', {
        remote: this.remote,
        time: this.lastPushTime.toISOString()
      });
      return true;
    } catch (error) {
      logger.error('GIT_LFS', 'Push failed', { remote: this.remote }, error as Error);
      return false;
    }
  }

  /**
   * Pull from remote repository
   */
  async pull(): Promise<boolean> {
    try {
      await this.runGit(['pull', this.remote, 'main']);
      logger.info('GIT_LFS', 'Pulled from remote', { remote: this.remote });
      return true;
    } catch (error) {
      logger.error('GIT_LFS', 'Pull failed', { remote: this.remote }, error as Error);
      return false;
    }
  }

  /**
   * Push if there are uncommitted changes
   */
  async pushIfChanged(): Promise<boolean> {
    if (!this.pendingChanges) {
      // Check git status
      try {
        const status = await this.runGit(['status', '--porcelain']);
        if (!status.trim()) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return await this.push();
  }

  /**
   * Get status of the export repository
   */
  async getStatus(): Promise<GitLfsSyncStatus> {
    const initialized = existsSync(path.join(this.exportDir, '.git'));

    let hasRemote = false;
    let remoteUrl: string | null = null;
    let fileCount = 0;
    let totalSize = 0;

    if (initialized) {
      try {
        remoteUrl = (await this.runGit(['remote', 'get-url', this.remote])).trim();
        hasRemote = !!remoteUrl;
      } catch {
        hasRemote = false;
      }

      // Count LFS tracked files
      try {
        const lsFiles = await this.runGit(['lfs', 'ls-files']);
        fileCount = lsFiles.split('\n').filter(l => l.trim()).length;
      } catch {
        // LFS not available
      }

      // Get total size of tracked files
      const files = ['vectors.db', 'full-export.db'];
      for (const file of files) {
        const filePath = path.join(this.exportDir, file);
        if (existsSync(filePath)) {
          totalSize += statSync(filePath).size;
        }
      }
    }

    // Check for pending changes
    let pendingChanges = this.pendingChanges;
    if (initialized && !pendingChanges) {
      try {
        const status = await this.runGit(['status', '--porcelain']);
        pendingChanges = !!status.trim();
      } catch {
        // Ignore
      }
    }

    return {
      initialized,
      hasRemote,
      remoteName: this.remote,
      remoteUrl,
      lastPush: this.lastPushTime,
      pendingChanges,
      lfsInstalled: this.isLfsInstalled(),
      fileCount,
      totalSize
    };
  }

  /**
   * Get the export directory path
   */
  getExportDir(): string {
    return this.exportDir;
  }

  /**
   * Check if auto-push should trigger based on idle time
   */
  shouldAutoPush(lastActivityTime: Date): boolean {
    if (!this.autoPush || !this.pendingChanges) {
      return false;
    }

    const idleMs = Date.now() - lastActivityTime.getTime();
    return idleMs >= this.idlePushSeconds * 1000;
  }
}
