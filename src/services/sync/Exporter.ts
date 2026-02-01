/**
 * Exporter Service
 *
 * Exports claude-mem data in various formats:
 * - sqlite: Vector database only (for sqlite-vec)
 * - full: Complete SQLite database (observations, sessions, summaries + vectors)
 * - json: JSON export with base64-encoded vectors
 */

import Database from 'bun:sqlite';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import { blobToEmbedding } from '../vector/EmbeddingProvider.js';

export type ExportFormat = 'sqlite' | 'full' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  outputPath?: string;
  project?: string;
  includeVectors?: boolean;
}

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  fileSize: number;
  recordCount: {
    observations: number;
    sessions: number;
    summaries: number;
    vectors?: number;
  };
  exportedAt: string;
}

export interface JsonExportData {
  version: string;
  exportedAt: string;
  hostname: string;
  platform: string;
  project?: string;
  observations: Array<{
    id: number;
    memory_session_id: string;
    project: string;
    title: string | null;
    narrative: string | null;
    facts: string[];
    concepts: string[];
    type: string;
    created_at: string;
    created_at_epoch: number;
  }>;
  sessions: Array<{
    id: number;
    content_session_id: string;
    memory_session_id: string | null;
    project: string;
    status: string;
    started_at: string;
  }>;
  summaries: Array<{
    id: number;
    memory_session_id: string;
    project: string;
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    notes: string | null;
    created_at: string;
  }>;
  vectors?: Array<{
    id: string;
    sqlite_id: number;
    doc_type: string;
    content: string;
    embedding_base64?: string;
  }>;
}

export class Exporter {
  private dataDir: string;
  private mainDbPath: string;
  private vectorsDbPath: string;

  constructor() {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    this.dataDir = settings.CLAUDE_MEM_DATA_DIR || path.join(os.homedir(), '.claude-mem');
    this.mainDbPath = path.join(this.dataDir, 'claude-mem.db');
    this.vectorsDbPath = path.join(this.dataDir, 'vectors.db');
  }

  /**
   * Export data in the specified format
   */
  async export(options: ExportOptions): Promise<ExportResult> {
    const { format, outputPath, project, includeVectors = true } = options;

    // Determine output path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let finalPath: string;

    if (outputPath) {
      finalPath = outputPath;
    } else {
      const ext = format === 'json' ? 'json' : 'db';
      finalPath = path.join(this.dataDir, 'exports', `export-${format}-${timestamp}.${ext}`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(finalPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    switch (format) {
      case 'sqlite':
        return this.exportSqlite(finalPath, project);
      case 'full':
        return this.exportFull(finalPath, project, includeVectors);
      case 'json':
        return this.exportJson(finalPath, project, includeVectors);
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }

  /**
   * Export sqlite-vec database only
   */
  private async exportSqlite(outputPath: string, project?: string): Promise<ExportResult> {
    if (!existsSync(this.vectorsDbPath)) {
      throw new Error('Vector database not found. Ensure sqlite-vec backend is enabled.');
    }

    if (project) {
      // Filter by project - need to create a new DB with filtered data
      const sourceDb = new Database(this.vectorsDbPath, { readonly: true });
      const destDb = new Database(outputPath);

      // Copy schema
      const tables = sourceDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
      for (const table of tables) {
        if (table.sql) {
          destDb.exec(table.sql);
        }
      }

      // Copy filtered data
      const docs = sourceDb.prepare('SELECT * FROM vector_documents WHERE project = ?').all(project);
      const insertStmt = destDb.prepare(`
        INSERT INTO vector_documents (id, sqlite_id, doc_type, content, memory_session_id, project, created_at_epoch, metadata, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const doc of docs as any[]) {
        insertStmt.run(doc.id, doc.sqlite_id, doc.doc_type, doc.content, doc.memory_session_id, doc.project, doc.created_at_epoch, doc.metadata, doc.embedding, doc.created_at);
      }

      const vectorCount = (destDb.prepare('SELECT COUNT(*) as count FROM vector_documents').get() as { count: number }).count;

      sourceDb.close();
      destDb.close();

      return {
        format: 'sqlite',
        outputPath,
        fileSize: statSync(outputPath).size,
        recordCount: {
          observations: 0,
          sessions: 0,
          summaries: 0,
          vectors: vectorCount
        },
        exportedAt: new Date().toISOString()
      };
    } else {
      // Simple copy
      copyFileSync(this.vectorsDbPath, outputPath);

      const db = new Database(outputPath, { readonly: true });
      const vectorCount = (db.prepare('SELECT COUNT(*) as count FROM vector_documents').get() as { count: number }).count;
      db.close();

      return {
        format: 'sqlite',
        outputPath,
        fileSize: statSync(outputPath).size,
        recordCount: {
          observations: 0,
          sessions: 0,
          summaries: 0,
          vectors: vectorCount
        },
        exportedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Export full database (main + vectors merged)
   */
  private async exportFull(outputPath: string, project?: string, includeVectors: boolean = true): Promise<ExportResult> {
    if (!existsSync(this.mainDbPath)) {
      throw new Error('Main database not found.');
    }

    // Start by copying main database
    copyFileSync(this.mainDbPath, outputPath);

    const destDb = new Database(outputPath);
    let vectorCount = 0;

    // If vectors should be included and exist, attach and copy
    if (includeVectors && existsSync(this.vectorsDbPath)) {
      destDb.exec(`ATTACH DATABASE '${this.vectorsDbPath}' AS vectors`);

      // Create vector tables in main db
      destDb.exec(`
        CREATE TABLE IF NOT EXISTS vector_documents (
          id TEXT PRIMARY KEY,
          sqlite_id INTEGER NOT NULL,
          doc_type TEXT NOT NULL,
          content TEXT NOT NULL,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          metadata TEXT,
          embedding BLOB,
          created_at TEXT
        )
      `);

      // Copy vector data
      if (project) {
        destDb.exec(`INSERT INTO vector_documents SELECT * FROM vectors.vector_documents WHERE project = '${project}'`);
      } else {
        destDb.exec('INSERT INTO vector_documents SELECT * FROM vectors.vector_documents');
      }

      destDb.exec('DETACH DATABASE vectors');

      vectorCount = (destDb.prepare('SELECT COUNT(*) as count FROM vector_documents').get() as { count: number }).count;
    }

    // Get counts
    let obsCount = 0, sessCount = 0, sumCount = 0;

    if (project) {
      obsCount = (destDb.prepare('SELECT COUNT(*) as count FROM observations WHERE project = ?').get(project) as { count: number }).count;
      sessCount = (destDb.prepare('SELECT COUNT(*) as count FROM sdk_sessions WHERE project = ?').get(project) as { count: number }).count;
      sumCount = (destDb.prepare('SELECT COUNT(*) as count FROM session_summaries WHERE project = ?').get(project) as { count: number }).count;
    } else {
      obsCount = (destDb.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number }).count;
      sessCount = (destDb.prepare('SELECT COUNT(*) as count FROM sdk_sessions').get() as { count: number }).count;
      sumCount = (destDb.prepare('SELECT COUNT(*) as count FROM session_summaries').get() as { count: number }).count;
    }

    destDb.close();

    return {
      format: 'full',
      outputPath,
      fileSize: statSync(outputPath).size,
      recordCount: {
        observations: obsCount,
        sessions: sessCount,
        summaries: sumCount,
        vectors: vectorCount
      },
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Export as JSON with optional base64-encoded vectors
   */
  private async exportJson(outputPath: string, project?: string, includeVectors: boolean = true): Promise<ExportResult> {
    if (!existsSync(this.mainDbPath)) {
      throw new Error('Main database not found.');
    }

    const mainDb = new Database(this.mainDbPath, { readonly: true });

    // Build JSON export
    const exportData: JsonExportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      hostname: os.hostname(),
      platform: os.platform(),
      project,
      observations: [],
      sessions: [],
      summaries: [],
      vectors: includeVectors ? [] : undefined
    };

    // Export observations
    const obsQuery = project
      ? 'SELECT * FROM observations WHERE project = ? ORDER BY id'
      : 'SELECT * FROM observations ORDER BY id';
    const observations = project
      ? mainDb.prepare(obsQuery).all(project)
      : mainDb.prepare(obsQuery).all();

    for (const obs of observations as any[]) {
      exportData.observations.push({
        id: obs.id,
        memory_session_id: obs.memory_session_id,
        project: obs.project,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts ? JSON.parse(obs.facts) : [],
        concepts: obs.concepts ? JSON.parse(obs.concepts) : [],
        type: obs.type,
        created_at: obs.created_at,
        created_at_epoch: obs.created_at_epoch
      });
    }

    // Export sessions
    const sessQuery = project
      ? 'SELECT * FROM sdk_sessions WHERE project = ? ORDER BY id'
      : 'SELECT * FROM sdk_sessions ORDER BY id';
    const sessions = project
      ? mainDb.prepare(sessQuery).all(project)
      : mainDb.prepare(sessQuery).all();

    for (const sess of sessions as any[]) {
      exportData.sessions.push({
        id: sess.id,
        content_session_id: sess.content_session_id,
        memory_session_id: sess.memory_session_id,
        project: sess.project,
        status: sess.status,
        started_at: sess.started_at
      });
    }

    // Export summaries
    const sumQuery = project
      ? 'SELECT * FROM session_summaries WHERE project = ? ORDER BY id'
      : 'SELECT * FROM session_summaries ORDER BY id';
    const summaries = project
      ? mainDb.prepare(sumQuery).all(project)
      : mainDb.prepare(sumQuery).all();

    for (const sum of summaries as any[]) {
      exportData.summaries.push({
        id: sum.id,
        memory_session_id: sum.memory_session_id,
        project: sum.project,
        request: sum.request,
        investigated: sum.investigated,
        learned: sum.learned,
        completed: sum.completed,
        next_steps: sum.next_steps,
        notes: sum.notes,
        created_at: sum.created_at
      });
    }

    mainDb.close();

    // Export vectors if requested
    if (includeVectors && existsSync(this.vectorsDbPath)) {
      const vectorDb = new Database(this.vectorsDbPath, { readonly: true });

      const vecQuery = project
        ? 'SELECT * FROM vector_documents WHERE project = ? ORDER BY id'
        : 'SELECT * FROM vector_documents ORDER BY id';
      const vectors = project
        ? vectorDb.prepare(vecQuery).all(project)
        : vectorDb.prepare(vecQuery).all();

      for (const vec of vectors as any[]) {
        const vecEntry: any = {
          id: vec.id,
          sqlite_id: vec.sqlite_id,
          doc_type: vec.doc_type,
          content: vec.content
        };

        // Convert embedding blob to base64
        if (vec.embedding) {
          vecEntry.embedding_base64 = Buffer.from(vec.embedding).toString('base64');
        }

        exportData.vectors!.push(vecEntry);
      }

      vectorDb.close();
    }

    // Write JSON
    writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

    return {
      format: 'json',
      outputPath,
      fileSize: statSync(outputPath).size,
      recordCount: {
        observations: exportData.observations.length,
        sessions: exportData.sessions.length,
        summaries: exportData.summaries.length,
        vectors: exportData.vectors?.length
      },
      exportedAt: exportData.exportedAt
    };
  }
}
