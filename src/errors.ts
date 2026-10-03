const MISSING_BASE_URL_MESSAGE = "No hosted default endpoint; pass baseURL or set VEXT_BASE_URL";

/** Thrown when a chat call has no `baseURL` and no base env var. */
export class MissingBaseURLError extends Error {
  constructor() {
    super(MISSING_BASE_URL_MESSAGE);
    this.name = "MissingBaseURLError";
  }
}
