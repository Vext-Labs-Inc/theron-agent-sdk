import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MissingBaseURLError, theronAdapter } from "../src/adapters/theron.js";

const ENV_KEY = "JUWEL_TOKEN";
const THERON_BASE = "THERON_BASE_URL";
const CUSTOM_BASE = "https://example.test";
const ENV_TOKEN = "env-token-value";
const CONFIG_TOKEN = "config-token-value";
const EXPLICIT_TOKEN = "explicit-token-value";
const MISSING_BASE = "No hosted default endpoint; pass baseURL";

const saved: {
  home?: string;
  token?: string;
  theronBase?: string;
  temp?: string;
  snapshotted: boolean;
  fetch: typeof fetch;
} = {
  snapshotted: false,
  fetch: globalThis.fetch,
};

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  globalThis.fetch = saved.fetch;
  if (saved.temp) await rm(saved.temp, { recursive: true, force: true });
  if (saved.snapshotted) {
    restoreEnv("HOME", saved.home);
    restoreEnv(ENV_KEY, saved.token);
    restoreEnv(THERON_BASE, saved.theronBase);
  }
  saved.home = undefined;
  saved.token = undefined;
  saved.theronBase = undefined;
  saved.temp = undefined;
  saved.snapshotted = false;
});

function captureFetch() {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("authorization") });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return calls;
}

async function isolateHome(): Promise<string> {
  saved.home = process.env.HOME;
  saved.token = process.env[ENV_KEY];
  saved.theronBase = process.env[THERON_BASE];
  saved.snapshotted = true;
  const home = await mkdtemp(path.join(tmpdir(), "theron-token-"));
  saved.temp = home;
  process.env.HOME = home;
  delete process.env[ENV_KEY];
  delete process.env[THERON_BASE];
  return home;
}

async function writeConfig(home: string, token: string) {
  const dir = path.join(home, ".juwel");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ token }), "utf8");
}

async function chat(opts: Parameters<typeof theronAdapter>[0]) {
  const adapter = theronAdapter(opts);
  await adapter.chat({
    model: "theron-council",
    messages: [{ role: "user", content: "hi" }],
  });
}

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

describe("theronAdapter base and implicit token", () => {
  it("throws before any request when no base and no env are set", async () => {
    await isolateHome();
    const calls = captureFetch();

    try {
      await chat({});
      expect.fail("expected MissingBaseURLError");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingBaseURLError);
      expect((err as Error).message).toBe(MISSING_BASE);
    }
    expect(calls).toHaveLength(0);
  });

  it("does not send the env token to a custom base", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: CUSTOM_BASE });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CUSTOM_BASE}/api/v1/chat/completions`);
    expect(calls[0].authorization).toBeNull();
  });

  it("sends an explicit token to a custom base even when the env token is set", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: CUSTOM_BASE, apiKey: EXPLICIT_TOKEN });

    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
  });

  it("does not treat a lookalike host as an allowed origin", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: "https://example.test.example.test" });
    await chat({ base: "https://example.test@example.test" });

    expect(calls[0].authorization).toBeNull();
    expect(calls[1].authorization).toBeNull();
  });

  it("throws before any request when a config-file token exists and no base is set", async () => {
    const home = await isolateHome();
    await writeConfig(home, CONFIG_TOKEN);
    const calls = captureFetch();

    await expect(chat({})).rejects.toThrow(MISSING_BASE);

    expect(calls).toHaveLength(0);
  });

  it("does not send the config-file token to a custom base", async () => {
    const home = await isolateHome();
    await writeConfig(home, CONFIG_TOKEN);
    const calls = captureFetch();

    await chat({ base: CUSTOM_BASE });

    expect(calls[0].authorization).toBeNull();
  });

  it("sends an explicit token to a custom base even when a config-file token exists", async () => {
    const home = await isolateHome();
    await writeConfig(home, CONFIG_TOKEN);
    const calls = captureFetch();

    await chat({ base: CUSTOM_BASE, apiKey: EXPLICIT_TOKEN });

    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
  });

  it.each([
    "http://example.test",
    "https://example.test:8443",
    "https://api.example.test",
    "https://example.test.evil.com",
    "https://example.test@evil.com",
    "https://example.test.",
    // Cyrillic a (U+0430) in place of Latin a.
    "https://ex\u0430mple.test",
  ])("does not send the env token to %s", async (base) => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base });

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeNull();
  });

  it("does not send the env token when the caller base is written in mixed case", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: "HTTPS://Example.Test" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("HTTPS://Example.Test/api/v1/chat/completions");
    expect(calls[0].authorization).toBeNull();
  });

  it("uses THERON_BASE_URL when no base option is set", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    process.env[THERON_BASE] = "https://from-env.example";
    const calls = captureFetch();

    await chat({});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://from-env.example/api/v1/chat/completions");
    expect(calls[0].authorization).toBeNull();
  });

  it("prefers the baseURL option over THERON_BASE_URL and base", async () => {
    await isolateHome();
    process.env[THERON_BASE] = "https://from-env.example";
    const calls = captureFetch();

    await chat({
      baseURL: "https://from-option.example/",
      base: "https://from-legacy-option.example",
    });

    expect(calls[0].url).toBe("https://from-option.example/api/v1/chat/completions");
  });

  it("uses the base option when baseURL is unset and it overrides THERON_BASE_URL", async () => {
    await isolateHome();
    process.env[THERON_BASE] = "https://from-env.example";
    const calls = captureFetch();

    await chat({ base: "https://from-legacy-option.example/" });

    expect(calls[0].url).toBe("https://from-legacy-option.example/api/v1/chat/completions");
  });

  it("sends an explicit tokenProvider result to the caller base", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({
      baseURL: CUSTOM_BASE,
      tokenProvider: async () => "provider-token",
    });

    expect(calls[0].authorization).toBe("Bearer provider-token");
  });

  it.each([302, 307])("errors on a %s redirect and does not resend Authorization", async (status) => {
    await isolateHome();
    const otherHits: string[] = [];
    const other = await listen((_req, res) => {
      otherHits.push(_req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "followed" } }] }));
    });
    const primaryHits: Array<{ authorization: string | undefined }> = [];
    const primary = await listen((req, res) => {
      primaryHits.push({ authorization: req.headers.authorization });
      res.writeHead(status, { Location: `${other.origin}/capture`, "content-length": "0" });
      res.end();
    });
    globalThis.fetch = saved.fetch;
    try {
      const attempt = chat({ baseURL: primary.origin, apiKey: EXPLICIT_TOKEN });
      await expect(attempt).rejects.toThrow(TypeError);
      expect(primaryHits).toHaveLength(1);
      expect(primaryHits[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
      expect(otherHits).toHaveLength(0);
    } finally {
      await primary.close();
      await other.close();
    }
  });
});
