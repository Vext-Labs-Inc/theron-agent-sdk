import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MissingBaseURLError, createVextAdapter, theronAdapter } from "../src/adapters/vext.js";

const ENV_KEY = "JUWEL_TOKEN";
const VEXT_BASE = "VEXT_BASE_URL";
const THERON_BASE = "THERON_BASE_URL";
const CUSTOM_BASE = "https://example.test";
const ENV_TOKEN = "env-token-value";
const CONFIG_TOKEN = "config-token-value";
const EXPLICIT_TOKEN = "explicit-token-value";
const MISSING_BASE = "No hosted default endpoint; pass baseURL or set VEXT_BASE_URL";

const saved: {
  home?: string;
  token?: string;
  vextBase?: string;
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
    restoreEnv(VEXT_BASE, saved.vextBase);
    restoreEnv(THERON_BASE, saved.theronBase);
  }
  saved.home = undefined;
  saved.token = undefined;
  saved.vextBase = undefined;
  saved.theronBase = undefined;
  saved.temp = undefined;
  saved.snapshotted = false;
});

function captureFetch() {
  const calls: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url: String(input),
      authorization: headers.get("authorization"),
      body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
    });
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
  saved.vextBase = process.env[VEXT_BASE];
  saved.theronBase = process.env[THERON_BASE];
  saved.snapshotted = true;
  const home = await mkdtemp(path.join(tmpdir(), "vext-token-"));
  saved.temp = home;
  process.env.HOME = home;
  delete process.env[ENV_KEY];
  delete process.env[VEXT_BASE];
  delete process.env[THERON_BASE];
  return home;
}

async function writeConfig(home: string, token: string) {
  const dir = path.join(home, ".juwel");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ token }), "utf8");
}

async function chat(opts: Parameters<typeof createVextAdapter>[0]) {
  const adapter = createVextAdapter(opts);
  await adapter.chat({
    model: "test-model",
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

describe("vext adapter base and implicit token", () => {
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
    expect(calls[0].url).toBe(`${CUSTOM_BASE}/chat/completions`);
    expect(calls[0].authorization).toBeNull();
  });

  it("sends an explicit token to a custom base even when the env token is set", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: CUSTOM_BASE, apiKey: EXPLICIT_TOKEN });

    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
  });

  it("does not treat a lookalike host as the default origin", async () => {
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
    expect(calls[0].url).toBe("HTTPS://Example.Test/chat/completions");
    expect(calls[0].authorization).toBeNull();
  });

  it("uses VEXT_BASE_URL when no base option is set", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    process.env[VEXT_BASE] = "https://from-vext-env.example";
    const calls = captureFetch();

    await chat({});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://from-vext-env.example/chat/completions");
    expect(calls[0].authorization).toBeNull();
  });

  it("uses THERON_BASE_URL when VEXT_BASE_URL is unset", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    process.env[THERON_BASE] = "https://from-alias-env.example";
    const calls = captureFetch();

    await chat({});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://from-alias-env.example/chat/completions");
    expect(calls[0].authorization).toBeNull();
  });

  it("prefers VEXT_BASE_URL when both base env vars are set", async () => {
    await isolateHome();
    process.env[VEXT_BASE] = "https://primary-env.example";
    process.env[THERON_BASE] = "https://alias-env.example";
    const calls = captureFetch();

    await chat({});

    expect(calls[0].url).toBe("https://primary-env.example/chat/completions");
  });

  it("prefers the baseURL option over both base env vars", async () => {
    await isolateHome();
    process.env[VEXT_BASE] = "https://primary-env.example";
    process.env[THERON_BASE] = "https://alias-env.example";
    const calls = captureFetch();

    await chat({ baseURL: "https://from-option.example/", base: "https://from-legacy-option.example" });

    expect(calls[0].url).toBe("https://from-option.example/chat/completions");
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

  it("deprecated theronAdapter is the same call path as createVextAdapter", async () => {
    await isolateHome();
    const calls = captureFetch();

    await theronAdapter({ baseURL: CUSTOM_BASE, apiKey: EXPLICIT_TOKEN }).chat({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(calls[0].url).toBe(`${CUSTOM_BASE}/chat/completions`);
    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
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

  it("posts an OpenAI-style base to /chat/completions and omits council_mode", async () => {
    await isolateHome();
    const calls = captureFetch();

    await chat({ baseURL: "https://api.openai.com/v1" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].body).not.toHaveProperty("council_mode");
    expect(calls[0].body.model).toBe("test-model");
  });

  it("posts an Ollama-style base to /chat/completions and omits council_mode", async () => {
    await isolateHome();
    const calls = captureFetch();

    await chat({ baseURL: "http://127.0.0.1:11434/v1" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(calls[0].body).not.toHaveProperty("council_mode");
  });

  it("sends council_mode only when the caller sets it", async () => {
    await isolateHome();
    const calls = captureFetch();

    await chat({ baseURL: CUSTOM_BASE, councilMode: "full" });

    expect(calls[0].body.council_mode).toBe("full");
  });

  it("throws before any request when model is missing", async () => {
    await isolateHome();
    const calls = captureFetch();
    const adapter = createVextAdapter({ baseURL: CUSTOM_BASE });

    await expect(adapter.chat({
      model: "  ",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow("Missing model; pass model");

    expect(calls).toHaveLength(0);
  });

  it("uses baseURL when process is absent", async () => {
    await isolateHome();
    const calls = captureFetch();
    const savedProcess = globalThis.process;
    Object.defineProperty(globalThis, "process", { configurable: true, writable: true, value: undefined });
    try {
      await chat({ baseURL: CUSTOM_BASE, apiKey: EXPLICIT_TOKEN });
    } finally {
      Object.defineProperty(globalThis, "process", { configurable: true, writable: true, value: savedProcess });
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${CUSTOM_BASE}/chat/completions`);
    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
  });
});
