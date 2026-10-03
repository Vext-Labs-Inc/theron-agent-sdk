/**
 * Account token provider for the Theron adapter.
 *
 * One account, every surface. Rather than pasting an API key, a user can
 * log in from the CLI, editor, or MCP client, which stores a scoped bearer
 * at ~/.juwel/config.json. This helper lets the SDK pick that token up
 * automatically so an agent authenticates as the signed-in account.
 *
 * Resolution: JUWEL_TOKEN env override, then ~/.juwel/config.json.
 * Node-only: on edge or browser runtimes (no node:fs) it returns undefined so
 * the adapter falls through to its existing free-tier / no-auth path.
 */

/** Resolve the device token: env override, then ~/.juwel/config.json.
 *  Returns undefined when no token is available or on a non-Node runtime. */
export async function resolveJuwelToken(): Promise<string | undefined> {
  const env = typeof process !== "undefined" && process.env ? process.env.JUWEL_TOKEN : undefined;
  if (env) return env;
  try {
    const [{ promises: fs }, os, path] = await Promise.all([
      import("fs"),
      import("os"),
      import("path"),
    ]);
    const file = path.join(os.homedir(), ".juwel", "config.json");
    const raw = await fs.readFile(file, "utf-8");
    const cfg = JSON.parse(raw) as { token?: unknown };
    if (cfg && typeof cfg === "object" && typeof cfg.token === "string" && cfg.token) {
      return cfg.token;
    }
  } catch {
    /* missing file, non-node, or unreadable config */
  }
  return undefined;
}
