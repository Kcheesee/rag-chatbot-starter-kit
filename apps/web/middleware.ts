import { NextResponse, type NextRequest } from "next/server";

/**
 * Restrict which host pages may embed the widget iframe.
 *
 * The widget chat is same-origin with the API (so no CORS is needed for its fetches);
 * the real control is a CSP `frame-ancestors` directive on the `/widget` route, set
 * from WIDGET_ALLOWED_ORIGINS. Unset → only same-origin embedding is allowed.
 */
export function middleware(_req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const origins = process.env.WIDGET_ALLOWED_ORIGINS;
  const ancestors =
    origins && origins.trim().length > 0
      ? origins
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
          .join(" ")
      : "'self'";
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors};`);
  return res;
}

export const config = {
  matcher: "/widget",
};
