# Vector Backend Module

Abstraction layer for vector storage backends supporting semantic search.

## Architecture

```
VectorBackend (interface)
├── ChromaBackend  - MCP-based ChromaDB integration
└── SqliteVecBackend - Local sqlite-vec implementation (planned)
```

## Key Files

- `VectorBackend.ts` - Interface definition
- `ChromaBackend.ts` - ChromaDB implementation via MCP
- `SqliteVecBackend.ts` - sqlite-vec implementation (TODO)
- `EmbeddingProvider.ts` - Embedding generation abstraction (TODO)

## Usage

```typescript
import { VectorBackend, ChromaBackend } from '../services/vector';

const backend: VectorBackend = new ChromaBackend('project-name');
await backend.initialize();

// Sync data
await backend.syncObservation(...);

// Query
const results = await backend.query('search text', 10, { project: 'myproject' });

// Cleanup
await backend.close();
```

## Design Decisions

1. **Interface-based** - All backends implement `VectorBackend`
2. **Lazy connection** - Backends connect on first use, not at initialization
3. **Fail-fast** - Errors propagate, no silent fallbacks
4. **Granular documents** - Each semantic field becomes a separate vector document

## Future: Resurrection Ship Model

The git-lfs export feature follows the "Resurrection Ship" mental model:

- **Separate repo** - Vector databases stored in dedicated repos, not in codebases
- **Team sharing** - Multiple team members can sync from shared memory repos
- **Federated queries** - `attachRemote()` and `queryFederated()` enable searching across multiple vector DBs
- **Knowledge resurrection** - Context can be "resurrected" across sessions, machines, and team members

```
Team Member A ──┐
                ├──► Shared Vector Repo ◄──── Federation queries
Team Member B ──┘         │
                          ▼
                    Local sqlite-vec
```