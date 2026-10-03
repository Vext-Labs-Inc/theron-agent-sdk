/**
 * JUWEL account token resolver. An exported helper you call yourself.
 *
 * The Vext adapter does not call this function and never attaches this token
 * on its own. It only sends an explicit `apiKey`, or the result of an explicit
 * `tokenProvider`, to the configured base (`baseURL`, `base`, `VEXT_BASE_URL`
 * or `THERON_BASE_URL`). To use this token, pass
 * `resolveJuwelToken` as `tokenProvider`:
 *
 *   createVextAdapter({ baseURL: "https://your-endpoint.example/v1", tokenProvider: resolveJuwelToken })
 *
 * Resolution order: the JUWEL_TOKEN env var, then the `token` field of
 * ~/.juwel/config.json. Returns undefined when neither is set, when the file
 * is missing or malformed, or on runtimes without node:fs (edge, browser).
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
