import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";

import { ACCESS_TOKEN_COOKIE } from "./auth-cookie";
import type { AppRole, AccessTokenClaims } from "./access-token.claims";

function jwtFromRequest(req: Request): string | null {
  const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (bearer) return bearer;
  const fromCookie = req?.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof fromCookie === "string" && fromCookie.length > 0 ? fromCookie : null;
}

/** Attached to `req.user` after Bearer JWT validation (includes userId + role from encoded payload). */
export type JwtUser = AccessTokenClaims;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || "leanifi-dev-secret",
    });
  }

  async validate(payload: AccessTokenClaims & { sub?: string; userId?: string }) {
    const userId = payload.userId ?? payload.sub;
    if (!userId?.trim()) throw new UnauthorizedException("Invalid token: missing userId");

    const allowed = new Set<AppRole>(["admin", "pharmacist", "driver", "customer"]);
    if (!payload.role || !allowed.has(payload.role)) throw new UnauthorizedException("Invalid token: missing or invalid role");

    const normalized: JwtUser = {
      sub: userId,
      userId,
      role: payload.role,
      name: payload.name ?? "",
      email: payload.email,
      phone: payload.phone,
    };
    return normalized;
  }
}

