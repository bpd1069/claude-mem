/**
 * Export CLI Command
 *
 * CLI command for exporting claude-mem data in various formats.
 *
 * Usage:
 *   claude-mem export --format=sqlite [--output=path] [--project=name]
 *   claude-mem export --format=full [--output=path] [--project=name]
 *   claude-mem export --format=json [--output=path] [--project=name] [--no-vectors]
 */

import { Exporter, type ExportFormat } from '../services/sync/Exporter.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function parseArgs(args: string[]): {
  format: ExportFormat;
  output?: string;
  project?: string;
  includeVectors: boolean;
} {
  let format: ExportFormat = 'json';
  let output: string | undefined;
  let project: string | undefined;
  let includeVectors = true;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      const val = arg.split('=')[1] as ExportFormat;
      if (!['sqlite', 'full', 'json'].includes(val)) {
        throw new Error(`Invalid format: ${val}. Must be sqlite, full, or json.`);
      }
      format = val;
    } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--project=') || arg.startsWith('-p=')) {
      project = arg.split('=')[1];
    } else if (arg === '--no-vectors') {
      includeVectors = false;
    }
  }

  return { format, output, project, includeVectors };
}

export async function exportCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: claude-mem export [options]

Export claude-mem data in various formats.

Options:
  --format=FORMAT    Export format: sqlite, full, or json (default: json)
  --output=PATH      Output file path (default: auto-generated)
  --project=NAME     Filter by project name
  --no-vectors       Exclude vector embeddings (json format only)
  --help, -h         Show this help message

Formats:
  sqlite   - Vector database only (sqlite-vec format)
  full     - Complete database with vectors merged
  json     - JSON export with optional base64-encoded vectors

Examples:
  claude-mem export --format=json
  claude-mem export --format=full --output=./backup.db
  claude-mem export --format=sqlite --project=myproject
  claude-mem export --format=json --no-vectors
`);
    process.exit(0);
  }

  try {
    const { format, output, project, includeVectors } = parseArgs(args);

    console.log(`Exporting data in ${format} format...`);
    if (project) {
      console.log(`Filtering by project: ${project}`);
    }

    const exporter = new Exporter();
    const result = await exporter.export({
      format,
      outputPath: output,
      project,
      includeVectors
    });

    console.log('\n=== Export Complete ===\n');
    console.log(`Format:       ${result.format}`);
    console.log(`Output:       ${result.outputPath}`);
    console.log(`Size:         ${formatBytes(result.fileSize)}`);
    console.log(`Exported at:  ${result.exportedAt}`);
    console.log('\nRecords:');
    console.log(`  Observations: ${result.recordCount.observations}`);
    console.log(`  Sessions:     ${result.recordCount.sessions}`);
    console.log(`  Summaries:    ${result.recordCount.summaries}`);
    if (result.recordCount.vectors !== undefined) {
      console.log(`  Vectors:      ${result.recordCount.vectors}`);
    }
    console.log('');
  } catch (error) {
    console.error(`Export failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
