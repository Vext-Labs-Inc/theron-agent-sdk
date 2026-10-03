/**
 * Compatibility shim for the previous adapter entry.
 *
 * @deprecated Import from `@vextlabs/sdk` or `@vextlabs/sdk/adapters/vext`.
 * `theronAdapter` and `theron` are the same function references as
 * `createVextAdapter` and `vext`.
 */
export {
  MissingBaseURLError,
  createVextAdapter,
  vext,
  theronAdapter,
  theron,
  resolveJuwelToken,
} from "./vext.js";
export type { VextAdapter, VextAdapterOptions, TheronAdapterOptions } from "./vext.js";
