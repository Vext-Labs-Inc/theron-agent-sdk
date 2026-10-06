/**
 * JUWEL account token resolver. Opt-in only.
 *
 * `theronAdapter` does not call this function on its own and never attaches
 * this token implicitly. To use it, pass it as `tokenProvider` together with
 * an explicit endpoint (`baseURL`, `base`, or `THERON_BASE_URL`). Without an
 * endpoint the adapter throws `MissingBaseURLError` before any network call.
 * An explicit `apiKey` takes precedence over `tokenProvider`.
 *
 *   theronAdapter({ baseURL: "https://your-endpoint.example", tokenProvider: resolveJuwelToken })
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
