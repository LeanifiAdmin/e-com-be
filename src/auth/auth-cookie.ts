import type { Response } from "express";

/** Cookie name for JWT — sent automatically on API requests when using `credentials: true`. */
export const ACCESS_TOKEN_COOKIE = "leanifi_access_token";

/** Align with `JwtModule` `signOptions.expiresIn` (7d). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function setAccessTokenCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_MS,
  });
}

export function clearAccessTokenCookie(res: Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { path: "/" });
}

export function setTokenCookieIfPresent(res: Response, body: unknown) {
  if (body && typeof body === "object" && "token" in body) {
    const token = (body as { token?: unknown }).token;
    if (typeof token === "string" && token.length > 0) {
      setAccessTokenCookie(res, token);
    }
  }
}
