/**
 * Subpath entry. Re-exports the root class so `instanceof MissingBaseURLError`
 * matches between `@vextlabs/theron-agent-sdk` and
 * `@vextlabs/theron-agent-sdk/adapters/theron`.
 */
export {
  theronAdapter,
  theron,
  MissingBaseURLError,
  resolveJuwelToken,
} from "@vextlabs/theron-agent-sdk";
export type { TheronAdapterOptions } from "@vextlabs/theron-agent-sdk";
