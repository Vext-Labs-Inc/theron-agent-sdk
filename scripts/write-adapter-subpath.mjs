import { mkdir, readFile, writeFile } from "node:fs/promises";

// Runs after tsup to write stable release wrappers for the adapter subpath.
// The subpath re-exports the root MissingBaseURLError class.
const source = await readFile("src/adapters/theron-subpath.ts", "utf8");
const dts = source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "");
const esm = dts.replace(/^export type \{[\s\S]*?;\s*/m, "");
const cjs = [
  '"use strict";',
  'const sdk = require("@vextlabs/theron-agent-sdk");',
  "exports.theronAdapter = sdk.theronAdapter;",
  "exports.theron = sdk.theron;",
  "exports.MissingBaseURLError = sdk.MissingBaseURLError;",
  "exports.resolveJuwelToken = sdk.resolveJuwelToken;",
  "",
].join("\n");

await mkdir("dist/adapters", { recursive: true });
await writeFile("dist/adapters/theron.js", esm);
await writeFile("dist/adapters/theron.cjs", cjs);
await writeFile("dist/adapters/theron.d.ts", dts);
await writeFile("dist/adapters/theron.d.cts", dts);
