/**
 * @deprecated Import `createVextAdapter` from `@vextlabs/sdk`.
 *
 * This file used to call a hosted path. There is no hosted default.
 * `theronAdapter` is the same function as `createVextAdapter`.
 * Pass `baseURL` or set `VEXT_BASE_URL`.
 */
export {
  createVextAdapter,
  createVextAdapter as theronAdapter,
  vext,
  vext as theron,
} from "../../src/adapters/vext.js";
