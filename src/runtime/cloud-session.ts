import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { promisify } from "util";

const pExecFile = promisify(execFile);

export interface CloudExecResult {
  stdout: string;
  stderr: string;
  /** 0 on success. Non-zero exit is RETURNED, never thrown. 124 = timeout. */
  exitCode: number;
}

export interface CloudExecOptions {
  /** Working directory, relative to (or inside) the session root. */
  cwd?: string;
  /** Hard timeout in ms (default 120000). */
  timeoutMs?: number;
  /** Extra environment variables for the command. */
  env?: Record<string, string>;
}

/**
 * An isolated, per-session execution environment with a filesystem.
 *
 * Lifecycle: a CloudSessionProvider hands back a live session from
 * `provision()`; call `dispose()` to release it. All file paths are resolved
 * INSIDE the session root; a path that escapes the root is rejected.
 */
export interface CloudSession {
  /** Stable id, for receipts and logs. */
  readonly id: string;
  /** Absolute path to the session filesystem root (backend-specific). */
  readonly root: string;
  /** Run a shell command in the session. Non-zero exit is returned, not thrown. */
  exec(command: string, options?: CloudExecOptions): Promise<CloudExecResult>;
  /** Read a session file as UTF-8 (path resolved inside the root). */
  readFile(path: string): Promise<string>;
  /** Write a session file, creating parent dirs (path resolved inside the root). */
  writeFile(path: string, content: string): Promise<void>;
  /** Release the session. Idempotent. */
  dispose(): Promise<void>;
}

export interface CloudSessionProvider {
  /** Provision a fresh, isolated session. */
  provision(): Promise<CloudSession>;
}

function resolveInside(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes session root: ${p}`);
  }
  return abs;
}

/**
 * In-process CloudSession backend: a temp workspace on the host, commands
 * via `/bin/sh -c`. For tests and local dev only — not a security boundary.
 */
export class LocalCloudSession implements CloudSession {
  readonly id: string;
  readonly root: string;
  private disposed = false;

  constructor(id: string, root: string) {
    this.id = id;
    this.root = root;
  }

  async exec(command: string, options: CloudExecOptions = {}): Promise<CloudExecResult> {
    if (this.disposed) throw new Error("session disposed");
    const cwd = options.cwd ? resolveInside(this.root, options.cwd) : this.root;
    try {
      const { stdout, stderr } = await pExecFile("/bin/sh", ["-c", command], {
        cwd,
        timeout: options.timeoutMs ?? 120_000,
        env: { ...process.env, ...(options.env ?? {}) },
        maxBuffer: 64 * 1024 * 1024,
      });
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
    } catch (e) {
      const err = e as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        killed?: boolean;
        code?: number | string;
      };
      const exitCode = typeof err.code === "number" ? err.code : err.killed ? 124 : 1;
      return {
        stdout: (err.stdout ?? "").toString(),
        stderr: (err.stderr ?? err.message ?? String(e)).toString(),
        exitCode,
      };
    }
  }

  async readFile(path: string): Promise<string> {
    if (this.disposed) throw new Error("session disposed");
    return readFile(resolveInside(this.root, path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.disposed) throw new Error("session disposed");
    const abs = resolveInside(this.root, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await rm(this.root, { recursive: true, force: true });
  }
}

/** Provisions LocalCloudSessions in fresh OS temp dirs. */
export class LocalCloudSessionProvider implements CloudSessionProvider {
  async provision(): Promise<CloudSession> {
    const id = randomUUID();
    const root = await mkdtemp(join(tmpdir(), `theron-session-${id.slice(0, 8)}-`));
    return new LocalCloudSession(id, root);
  }
}
