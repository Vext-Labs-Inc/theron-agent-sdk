/**
 * JUWEL account — token provider for the Theron adapter.
 *
 * One JUWEL account, every surface. Rather than pasting an API key, a user can
 * `juwel login` (from the CLI / VS Code / MCP) which runs the browserless
 * device-code flow and stores a scoped `jak_` bearer at ~/.juwel/config.json.
 * This helper lets the SDK pick that token up automatically so an agent you
 * build authenticates as the signed-in JUWEL account with no extra config.
 *
 * Resolution here is: JUWEL_TOKEN env override, then ~/.juwel/config.json.
 * Node-only: on edge / browser runtimes (no node:fs) it returns undefined so
 * the adapter falls through to its existing free-tier / no-auth path.
 */

/** Resolve the JUWEL device token: env override, then ~/.juwel/config.json.
 *  Returns undefined when no token is available or on a non-Node runtime. */
export async function resolveJuwelToken(): Promise<string | undefined> {
  // Env override first — works even where the filesystem is unavailable.
  const env =
    typeof process !== "undefined" && process.env
      ? process.env.JUWEL_TOKEN
      : undefined;
  if (env) return env;

  // File fallback — Node only. Any failure (edge/browser, missing file,
  // malformed JSON, permissions) yields undefined, never throws.
  try {
    const [{ promises: fs }, os, path] = await Promise.all([
      import("node:fs"),
      import("node:os"),
      import("node:path"),
    ]);
    const file = path.join(os.homedir(), ".juwel", "config.json");
    const raw = await fs.readFile(file, "utf-8");
    const cfg = JSON.parse(raw) as { token?: unknown } | null;
    if (cfg && typeof cfg === "object" && typeof cfg.token === "string" && cfg.token) {
      return cfg.token;
    }
  } catch {
    /* not on Node, or no config — fall through */
  }
  return undefined;
}
