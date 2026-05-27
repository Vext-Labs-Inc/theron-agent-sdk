// Memory — cross-session, durable knowledge.
//
// Distinct from Session (which is scoped to one run). Memory is what an
// agent remembers between sessions: user preferences, learned facts,
// project context, prior decisions.

export interface MemoryRecord {
  /** Unique identifier. */
  id: string;
  /** Key for retrieval. */
  key: string;
  /** The actual content. */
  value: string;
  /** Tenant scope (multi-tenant deployments). Always filter on this in
   *  production — there is no implicit isolation. */
  tenant_id?: string;
  /** Optional tags for categorization. */
  tags?: string[];
  /** When this memory was created. */
  created_at: number;
  /** When this memory was last accessed (for LRU eviction). */
  last_accessed_at: number;
  /** Optional embedding for semantic search (1024-dim float32). */
  embedding?: number[];
}

export interface MemoryQuery {
  /** Filter by tenant. */
  tenant_id?: string;
  /** Exact key lookup. */
  key?: string;
  /** Tag-based filter. */
  tags?: string[];
  /** Semantic search by similarity to this query string. */
  semantic_query?: string;
  /** Max records to return. */
  limit?: number;
}

/**
 * Memory — abstract interface; implementations plug in any backend.
 *
 * Built-in implementations:
 *   - InMemoryStore (default; for development)
 *   - For production, plug in pgvector, R2, SQLite, etc. by extending Memory.
 *
 * Minimal usage:
 *   const mem = new InMemoryStore();
 *   await mem.set({
 *     key: "user_name", value: "Annalea",
 *     created_at: Date.now(), last_accessed_at: Date.now(),
 *   });
 *   const records = await mem.query({ key: "user_name" });
 */
export abstract class Memory {
  abstract set(record: Omit<MemoryRecord, "id"> & { id?: string }): Promise<MemoryRecord>;
  abstract get(id: string): Promise<MemoryRecord | undefined>;
  abstract query(q: MemoryQuery): Promise<MemoryRecord[]>;
  abstract delete(id: string): Promise<void>;
}

/**
 * InMemoryStore — default Memory implementation. Volatile; for development.
 * Production should swap in a persistent backend.
 *
 * NOTE: this implementation does NOT enforce tenant isolation at the storage
 * layer — `query({ tenant_id })` filters but does not partition. Production
 * backends should partition by tenant at the storage layer.
 */
export class InMemoryStore extends Memory {
  private records: Map<string, MemoryRecord> = new Map();

  async set(record: Omit<MemoryRecord, "id"> & { id?: string }): Promise<MemoryRecord> {
    const id = record.id ?? `mem_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const full: MemoryRecord = {
      ...record,
      id,
      created_at: record.created_at ?? Date.now(),
      last_accessed_at: record.last_accessed_at ?? Date.now(),
    };
    this.records.set(id, full);
    return full;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const r = this.records.get(id);
    if (r) {
      r.last_accessed_at = Date.now();
    }
    return r;
  }

  async query(q: MemoryQuery): Promise<MemoryRecord[]> {
    let results = Array.from(this.records.values());
    if (q.tenant_id !== undefined) {
      results = results.filter((r) => r.tenant_id === q.tenant_id);
    }
    if (q.key !== undefined) {
      results = results.filter((r) => r.key === q.key);
    }
    if (q.tags !== undefined && q.tags.length > 0) {
      results = results.filter((r) => r.tags?.some((t) => q.tags!.includes(t)));
    }
    if (q.semantic_query !== undefined) {
      // Stub: in production this is pgvector or similar. Here it's a
      // case-insensitive substring match — useful only for tests + demos.
      const ql = q.semantic_query.toLowerCase();
      results = results.filter((r) => r.value.toLowerCase().includes(ql));
    }
    results.sort((a, b) => b.last_accessed_at - a.last_accessed_at);
    if (q.limit !== undefined) {
      results = results.slice(0, q.limit);
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}
