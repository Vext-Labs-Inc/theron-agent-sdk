import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  MissingBaseURLError as RootError,
  createVextAdapter,
  theron,
  theronAdapter,
  vext,
  type TheronAdapterOptions,
  type VextAdapterOptions,
} from "../dist/index.js";
import {
  MissingBaseURLError as SubError,
  createVextAdapter as subCreate,
} from "../dist/adapters/vext.js";
import * as vextEntry from "../src/adapters/vext.js";
import * as theronEntry from "../src/adapters/theron.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  name: string;
  exports: Record<string, { types: string; import: string; require: string }>;
};

describe("Vext adapter compatibility shim", () => {
  it("keeps deprecated theron names as the same references as the Vext names", () => {
    expect(theronAdapter).toBe(createVextAdapter);
    expect(theron).toBe(vext);
    expect(vext).toBe(createVextAdapter);
    expect(theronEntry.theronAdapter).toBe(vextEntry.createVextAdapter);
    expect(theronEntry.theron).toBe(vextEntry.vext);
    expect(theronEntry.createVextAdapter).toBe(vextEntry.createVextAdapter);
    expect(vextEntry.theronAdapter).toBe(vextEntry.createVextAdapter);
    expect(vextEntry.vext).toBe(vextEntry.createVextAdapter);
  });

  it("accepts the deprecated options type as the Vext options type", () => {
    const legacy: TheronAdapterOptions = { baseURL: "https://example.test" };
    const current: VextAdapterOptions = legacy;
    expect(current.baseURL).toBe("https://example.test");
  });

  it("publishes the vext subpath and points the theron subpath at the same module", () => {
    expect(pkg.name).toBe("@vextlabs/sdk");
    expect(pkg.exports["./adapters/vext"]).toEqual({
      types: "./dist/adapters/vext.d.ts",
      import: "./dist/adapters/vext.js",
      require: "./dist/adapters/vext.cjs",
    });
    expect(pkg.exports["./adapters/theron"]).toEqual(pkg.exports["./adapters/vext"]);
  });

  it("shares one MissingBaseURLError across the root and subpath bundles", async () => {
    expect(RootError).toBe(SubError);
    expect(createVextAdapter).toBe(subCreate);
    const savedVext = process.env.VEXT_BASE_URL;
    const savedTheron = process.env.THERON_BASE_URL;
    const savedFetch = globalThis.fetch;
    let fetches = 0;
    delete process.env.VEXT_BASE_URL;
    delete process.env.THERON_BASE_URL;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("unexpected fetch");
    }) as typeof fetch;
    try {
      const err = await createVextAdapter({}).chat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      }).catch((caught: unknown) => caught);
      expect(err).toBeInstanceOf(RootError);
      expect(err).toBeInstanceOf(SubError);

      const rootCjs = require("../dist/index.cjs") as {
        MissingBaseURLError: new () => Error;
        createVextAdapter: typeof createVextAdapter;
      };
      const subCjs = require("../dist/adapters/vext.cjs") as {
        MissingBaseURLError: new () => Error;
        createVextAdapter: typeof createVextAdapter;
      };
      expect(rootCjs.MissingBaseURLError).toBe(subCjs.MissingBaseURLError);
      expect(rootCjs.createVextAdapter).toBe(subCjs.createVextAdapter);
      const cjsErr = await rootCjs.createVextAdapter({}).chat({
        model: "test-model",
        messages: [{ role: "user", content: "hi" }],
      }).catch((caught: unknown) => caught);
      expect(cjsErr).toBeInstanceOf(rootCjs.MissingBaseURLError);
      expect(cjsErr).toBeInstanceOf(subCjs.MissingBaseURLError);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedVext === undefined) delete process.env.VEXT_BASE_URL;
      else process.env.VEXT_BASE_URL = savedVext;
      if (savedTheron === undefined) delete process.env.THERON_BASE_URL;
      else process.env.THERON_BASE_URL = savedTheron;
    }
  });
});
