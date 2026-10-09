import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Thrown anywhere below a route; the app's error handler turns it into JSON. */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
