import { defineConfig } from "tsup";

// Build matrix:
//   - ESM + CJS bundles per public entry point
//   - .d.ts emitted for every entry
//   - Tree-shakeable: each subpath exports independently
//   - No source maps in the npm tarball (kept under 500 KB)
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "agent/index": "src/agent/index.ts",
    "council/index": "src/council/index.ts",
    "session/index": "src/session/index.ts",
    "memory/index": "src/memory/index.ts",
    "tools/index": "src/tools/index.ts",
    "verifiers/index": "src/verifiers/index.ts",
    "runtime/index": "src/runtime/index.ts",
    "mcp/index": "src/mcp/index.ts",
    "receipts/index": "src/receipts/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
});
