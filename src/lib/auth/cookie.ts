/**
 * Session cookie name. Shared by the proxy (optimistic check) and the server
 * session code. `__Host-` requires Secure + path=/ + no Domain, so it's only
 * used in production (HTTPS).
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gam3ya_session" : "gam3ya_session";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
