import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

import { IS_PUBLIC_KEY } from "./public.decorator";

const BEARER_HINT =
  "Protected API: send Authorization: Bearer <JWT> or session cookie leanifi_access_token (set on login; use credentials on cross-origin requests).";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: Error | undefined,
    user: TUser | false,
    info: Error | string | undefined,
    context: ExecutionContext
  ): TUser {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return user as TUser;
    }

    if (err) {
      throw err;
    }
    if (!user) {
      const detail =
        typeof info === "string"
          ? info
          : info && typeof info === "object" && "message" in info
            ? String((info as Error).message)
            : "No or invalid JWT (Bearer header or session cookie)";
      throw new UnauthorizedException({ message: BEARER_HINT, reason: detail });
    }
    return user;
  }
}
