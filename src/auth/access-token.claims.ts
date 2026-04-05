/**
 * Claims embedded in the access JWT (signed + base64url-encoded in the token string).
 * `exp` / `iat` are added automatically by JwtModule signOptions.expiresIn.
 */
export type AppRole = "admin" | "pharmacist" | "driver" | "customer";

export type AccessTokenClaims = {
  /** JWT "subject" — same value as userId (username / stable id in our DB). */
  sub: string;
  /** Explicit user id for APIs and clients (duplicate of sub for clarity). */
  userId: string;
  role: AppRole;
  name: string;
  email?: string;
  phone?: string;
};

export function buildAccessTokenClaims(params: {
  userId: string;
  role: AppRole;
  name: string;
  email?: string;
  phone?: string;
}): AccessTokenClaims {
  const { userId, role, name, email, phone } = params;
  return {
    sub: userId,
    userId,
    role,
    name,
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
  };
}
