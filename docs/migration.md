# Data Migration

Import observations from external databases with different schemas into your local claude-mem database.

## Overview

The migration feature transforms external data formats to match claude-mem's internal schema, enabling you to:

- Import team memory from shared repositories
- Consolidate data from multiple databases
- Migrate from older schema versions
- Onboard data from other memory systems

## UI Configuration

Access migration settings via **Settings → Migration** (collapsed by default).

![Migration Settings Panel](migration-settings.png)

### Source Configuration

| Field | Description |
|-------|-------------|
| **Source URL** | API endpoint of the external database |
| **Source Name** | Identifier for this import source |
| **Target Project** | Project name assigned to imported observations |

### Field Mappings

Map external field names to claude-mem's internal schema. Supports dot notation for nested fields (e.g., `data.info.title`).

| Internal Field | Description | Default |
|----------------|-------------|---------|
| ID Field | Unique identifier | `id` |
| Title Field | Observation title | `title` |
| Narrative Field | Main content/body | `narrative` |
| Type Field | Observation category | `type` |
| Timestamp Field | Creation timestamp | `created_at_epoch` |

### Transforms

| Option | Values | Description |
|--------|--------|-------------|
| **Timestamp Format** | `epoch_ms`, `epoch_s`, `iso8601` | How timestamps are encoded in source |

### Options

| Toggle | Description |
|--------|-------------|
| **Dry Run** | Validate and preview without persisting data |

## CLI Usage

After configuring settings in the UI, run migrations via CLI:

```bash
# Basic migration
bun claude-mem migrate \
  --source "https://team-memory.example.com/api" \
  --project "imported-data"

# With custom field mappings
bun claude-mem migrate \
  --source "https://external.db/api" \
  --project "team-memory" \
  --field-title "summary" \
  --field-narrative "content" \
  --field-timestamp "metadata.created_at" \
  --timestamp-format iso8601

# Dry run (validate only)
bun claude-mem migrate \
  --source "https://external.db/api" \
  --project "test" \
  --dry-run
```

## Programmatic Usage

```typescript
import { createMigrator } from 'claude-mem/services/federation/SchemaMigrator';

const migrator = createMigrator({
  id: 'team-memory',
  name: 'Team Memory Import',
  url: 'https://team.example.com/api',
  fields: {
    id: 'observation_id',
    title: 'summary',
    narrative: 'content',
    type: 'category',
    timestamp: 'metadata.created_at',
  },
  transforms: {
    timestamp: 'iso8601',
  },
});

// Validate first
const validation = migrator.validateBatch(externalRecords);
console.log(`Valid: ${validation.valid}, Invalid: ${validation.invalid}`);

// Then import
const result = migrator.migrateBatch(externalRecords, {
  targetProject: 'imported-data',
  onProgress: (processed, total) => {
    console.log(`Progress: ${processed}/${total}`);
  },
});

console.log(`Imported: ${result.imported}, Duplicates: ${result.duplicates}`);
```

## Deduplication

Records are deduplicated based on:
- Memory session ID
- Title
- Timestamp (created_at_epoch)

Re-running a migration will skip previously imported records.

## Schema Adapter Reference

The migration system uses `SchemaAdapter` to transform external schemas:

```typescript
interface RemoteSchemaConfig {
  id: string;           // Unique adapter ID
  name: string;         // Human-readable name
  url: string;          // Source URL
  fields: {
    id?: string;        // External ID field
    title?: string;     // External title field
    subtitle?: string;  // External subtitle field
    narrative?: string; // External content field
    type?: string;      // External type/category field
    timestamp?: string; // External timestamp field
    embedding?: string; // External vector field
  };
  transforms?: {
    timestamp?: 'epoch_ms' | 'epoch_s' | 'iso8601';
    embedding?: 'array' | 'base64' | 'json_array';
    facts?: 'json' | 'csv' | 'array';
  };
}
```

## Best Practices

1. **Always dry run first** - Validate schema mappings before importing
2. **Use specific field mappings** - Don't rely on defaults for external schemas
3. **Set meaningful project names** - Helps organize imported data
4. **Monitor progress** - Use callbacks for large imports
5. **Check for duplicates** - Review import results before proceeding
