// CloudSession — the seam behind cloud routines: an
// isolated, per-session execution environment with a filesystem, where tools
// run server-side instead of on the user's machine.
//
// A PRODUCTION implementation is backed by a provisioned cloud VM or sandbox
// (E2B, Firecracker microVM, a RunPod pod, a Modal sandbox, …). Those cost real
// money per running session and need infra stood up — they are deliberately NOT
// implemented here. What IS here is:
//   - the provider-agnostic CloudSession / CloudSessionProvider contract, and
//   - LocalCloudSession, an in-process backend (a temp workspace + child_process)
//     for tests, CI, and local development that satisfies the same contract.
//
// SECURITY: LocalCloudSession runs on the HOST machine and is NOT a security
// boundary — it is for development/testing only. Real isolation (one tenant
// cannot see another, the host is protected) is the job of the cloud-VM backend.
// Do not route untrusted multi-tenant traffic through LocalCloudSession.

import {
  mkdtemp,
  rm,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute, resolve, relative, dirname, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

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
  /**
   * Extra environment variables for the command. Copied as given, after the
   * inherited allowlist. This is the only way to pass a name that is not on
   * that allowlist. The shell does not inherit `HTTP_PROXY`, `HTTPS_PROXY`,
   * `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `npm_config_*`,
   * `SSH_AUTH_SOCK`, `NVM_*`, `XDG_*`, or `VIRTUAL_ENV`. Set those here when
   * the command needs them, for example
   * `env: { HTTPS_PROXY: "http://127.0.0.1:8888", SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK ?? "" }`.
   */
  env?: Record<string, string>;
}

/**
 * Names copied from `process.env` into a session shell. The copy is
 * allowlist-only: every other parent variable is omitted, and there is no
 * second deny-list pass. `JUWEL_TOKEN` and names ending in `_TOKEN`, `_KEY`,
 * or `_SECRET` are absent because they are not on this list. Proxy, CA,
 * npm, ssh-agent, nvm, XDG, and virtualenv variables are also absent; pass
 * them through `CloudExecOptions.env`.
 */
const INHERITED_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "USER",
  "LOGNAME",
] as const;

/** Allowlisted parent env, then the caller's explicit `options.env`. */
function sessionCommandEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) env[key] = value;
  }
  return env;
}

/**
 * An isolated, per-session execution environment with a filesystem.
 *
 * Lifecycle: a {@link CloudSessionProvider} hands back a live session from
 * `provision()`; call `dispose()` to release it (tear down the VM / delete the
 * workspace). All file paths are resolved INSIDE the session root; a path that
 * escapes the root is rejected.
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

/** Resolve `p` inside `root`, rejecting any path that escapes the root. */
function resolveInside(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  // Escape iff rel is exactly ".." or a "../"-prefixed path (not just a name
  // that happens to start with ".."), or an absolute path on another root.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes session root: ${p}`);
  }
  return abs;
}

/**
 * In-process {@link CloudSession} backend: a temp workspace on the host, commands
 * via `/bin/sh -c`. For tests/CI/local dev only — NOT a security boundary.
 *
 * `exec` does not pass the parent `process.env` through. The environment is
 * allowlist-only (`PATH`, `HOME`, `LANG`, `TERM`, and similar locale and temp
 * variables) and then `options.env` copied as given. Nothing else is inherited,
 * including `JUWEL_TOKEN`, `*_TOKEN` / `*_KEY` / `*_SECRET`, `HTTP_PROXY`,
 * `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`,
 * `npm_config_*`, `SSH_AUTH_SOCK`, `NVM_*`, `XDG_*`, and `VIRTUAL_ENV`.
 * Pass any of those on `options.env` when the command needs them.
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
        env: sessionCommandEnv(options.env),
        maxBuffer: 64 * 1024 * 1024,
      });
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string; code?: unknown; killed?: boolean };
      const exitCode =
        typeof err.code === "number" ? err.code : err.killed ? 124 : 1;
      return {
        stdout: (err.stdout ?? "").toString(),
        stderr: (err.stderr ?? err.message ?? String(e)).toString(),
        exitCode,
      };
    }
  }

  async readFile(path: string): Promise<string> {
    if (this.disposed) throw new Error("session disposed");
    return fsReadFile(resolveInside(this.root, path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.disposed) throw new Error("session disposed");
    const abs = resolveInside(this.root, path);
    await mkdir(dirname(abs), { recursive: true });
    await fsWriteFile(abs, content, "utf8");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await rm(this.root, { recursive: true, force: true });
  }
}

/** Provisions {@link LocalCloudSession}s in fresh OS temp dirs. */
export class LocalCloudSessionProvider implements CloudSessionProvider {
  async provision(): Promise<CloudSession> {
    const id = randomUUID();
    const root = await mkdtemp(join(tmpdir(), `vext-session-${id.slice(0, 8)}-`));
    return new LocalCloudSession(id, root);
  }
}
