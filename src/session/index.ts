// Session — the present-time event log for a single agent run.
//
// Distinct from Memory (which is cross-session). A session is a scoped
// timeline of events: user input, agent output, tool calls, verifier results,
// state transitions. Useful for checkpointing + time-travel debug.

export type SessionEvent =
  | { type: "user_input"; content: string; ts: number }
  | { type: "agent_output"; agent: string; content: string; ts: number }
  | { type: "tool_call"; tool: string; input: unknown; output: unknown; ts: number; ms: number }
  | { type: "verifier_result"; kernel: string; pass: boolean; issues: unknown[]; ts: number }
  | { type: "state_change"; key: string; before: unknown; after: unknown; ts: number }
  | { type: "error"; agent: string; message: string; ts: number };

export interface SessionConfig {
  /** Unique session identifier. Generated if not provided. */
  id?: string;
  /** Optional tenant scope. */
  tenant_id?: string;
  /** Optional initial state. */
  initial_state?: Record<string, unknown>;
}

export type SessionJSON = {
  id: string;
  tenant_id?: string;
  state: Record<string, unknown>;
  events: SessionEvent[];
};

/**
 * Session — append-only event log + scoped state.
 *
 * Minimal usage:
 *   const sess = new Session();
 *   sess.append({ type: "user_input", content: "Hello", ts: Date.now() });
 *   sess.state.set("user_name", "Annalea");
 *
 * Persistence: by default, sessions are in-memory. Plug in a persistence
 * adapter (Postgres, R2, SQLite) via the toJSON / fromJSON pair.
 */
export class Session {
  public readonly id: string;
  public readonly tenant_id: string | undefined;
  public readonly state: Map<string, unknown>;
  private readonly events: SessionEvent[];

  constructor(config: SessionConfig = {}) {
    this.id = config.id ?? cryptoRandomId();
    this.tenant_id = config.tenant_id;
    this.state = new Map(Object.entries(config.initial_state ?? {}));
    this.events = [];
  }

  append(event: SessionEvent): void {
    this.events.push(event);
  }

  /** Get a read-only snapshot of all events. */
  getEvents(): readonly SessionEvent[] {
    return this.events;
  }

  /** Get events of a specific type (typed). */
  getEventsOfType<T extends SessionEvent["type"]>(
    type: T,
  ): Extract<SessionEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<SessionEvent, { type: T }>[];
  }

  /** Serialize the session for persistence. */
  toJSON(): SessionJSON {
    return {
      id: this.id,
      tenant_id: this.tenant_id,
      state: Object.fromEntries(this.state.entries()),
      events: this.events.slice(),
    };
  }

  /** Restore a session from its serialized form. */
  static fromJSON(data: SessionJSON): Session {
    const sess = new Session({ id: data.id, tenant_id: data.tenant_id, initial_state: data.state });
    for (const e of data.events) sess.events.push(e);
    return sess;
  }
}

function cryptoRandomId(): string {
  // Browser + Node 20+ both support crypto.randomUUID.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
