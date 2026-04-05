import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { IS_PUBLIC_KEY } from "./public.decorator";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();

    // Non-public route: require an authenticated user (JWT validated by JwtAuthGuard).
    if (!requiredRoles?.length) {
      if (!req?.user) throw new UnauthorizedException("Unauthorized");
      return true;
    }

    const userRole = req?.user?.role as string | undefined;

    if (!userRole) throw new UnauthorizedException("JWT payload missing role");
    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Role "${userRole}" is not allowed for this endpoint. Required: ${requiredRoles.join(", ")}`
      );
    }
    return true;
  }
}

