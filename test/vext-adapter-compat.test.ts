import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  createVextAdapter,
  theron,
  theronAdapter,
  vext,
  type TheronAdapterOptions,
  type VextAdapterOptions,
} from "../src/index.js";
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
    expect(theronEntry.createVextAdapter).toBe(createVextAdapter);
    expect(vextEntry.theronAdapter).toBe(createVextAdapter);
    expect(vextEntry.vext).toBe(vext);
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
});
