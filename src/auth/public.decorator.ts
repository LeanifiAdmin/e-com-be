import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Skips JWT + role checks. Only these areas should be public:
 * - Auth: token exchange (login/signup/OTP) and app root health
 * - Catalog: guest product browsing (storefront)
 * Everything else requires a valid JWT via `Authorization: Bearer` and/or httpOnly cookie `leanifi_access_token`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
