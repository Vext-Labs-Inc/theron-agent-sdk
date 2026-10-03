import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { theronAdapter } from "../src/adapters/theron.js";

const ENV_KEY = "JUWEL_TOKEN";
const CUSTOM_BASE = "https://example.test";
const ENV_TOKEN = "env-token-value";
const CONFIG_TOKEN = "config-token-value";
const EXPLICIT_TOKEN = "explicit-token-value";

const saved: { home?: string; token?: string; temp?: string; fetch: typeof fetch } = {
  fetch: globalThis.fetch,
};

afterEach(async () => {
  globalThis.fetch = saved.fetch;
  if (saved.temp) await rm(saved.temp, { recursive: true, force: true });
  if ("home" in saved) {
    if (saved.home === undefined) delete process.env.HOME;
    else process.env.HOME = saved.home;
  }
  if (saved.token === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved.token;
  saved.home = undefined;
  saved.token = undefined;
  saved.temp = undefined;
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
  const home = await mkdtemp(path.join(tmpdir(), "theron-token-"));
  saved.temp = home;
  process.env.HOME = home;
  delete process.env[ENV_KEY];
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

describe("theronAdapter implicit token", () => {
  it("sends the env token on the default base", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://itstheron.com/api/v1/chat/completions");
    expect(calls[0].authorization).toBe(`Bearer ${ENV_TOKEN}`);
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

  it("does not treat a lookalike host as the default origin", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: "https://itstheron.com.example.test" });
    await chat({ base: "https://itstheron.com@example.test" });

    expect(calls[0].authorization).toBeNull();
    expect(calls[1].authorization).toBeNull();
  });

  it("sends the config-file token on the default base", async () => {
    const home = await isolateHome();
    await writeConfig(home, CONFIG_TOKEN);
    const calls = captureFetch();

    await chat({});

    expect(calls[0].authorization).toBe(`Bearer ${CONFIG_TOKEN}`);
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
    "http://itstheron.com",
    "https://itstheron.com:8443",
    "https://api.itstheron.com",
    "https://itstheron.com.evil.com",
    "https://itstheron.com@evil.com",
    "https://itstheron.com.",
    // Cyrillic o (U+043E) in place of Latin o.
    "https://itsther\u043en.com",
  ])("does not send the env token to %s", async (base) => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base });

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBeNull();
  });

  it("sends the env token when the default origin is written in mixed case", async () => {
    await isolateHome();
    process.env[ENV_KEY] = ENV_TOKEN;
    const calls = captureFetch();

    await chat({ base: "HTTPS://ItsTheron.com" });

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe(`Bearer ${ENV_TOKEN}`);
  });

  it.each([302, 307])("errors on a %s redirect and does not resend Authorization", async (status) => {
    await isolateHome();
    const calls: Array<{ url: string; authorization: string | null; redirect?: RequestRedirect }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("authorization");
      calls.push({ url, authorization, redirect: init?.redirect });
      if (url.startsWith("https://evil.example/")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "followed" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (init?.redirect === "error") {
        throw new TypeError(`redirect mode is error (${status})`);
      }
      return globalThis.fetch("https://evil.example/capture", init);
    }) as typeof fetch;

    await expect(chat({ apiKey: EXPLICIT_TOKEN })).rejects.toThrow(String(status));

    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("error");
    expect(calls[0].authorization).toBe(`Bearer ${EXPLICIT_TOKEN}`);
    expect(calls.some((call) => call.url.startsWith("https://evil.example/"))).toBe(false);
  });
});
