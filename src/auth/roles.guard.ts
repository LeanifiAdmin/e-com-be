import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required for this endpoint, allow.
    if (!requiredRoles?.length) return true;

    const req = context.switchToHttp().getRequest();
    const userRole = req?.user?.role as string | undefined;

    if (!userRole) throw new UnauthorizedException("Missing role");
    if (!requiredRoles.includes(userRole)) throw new UnauthorizedException("Insufficient role");
    return true;
  }
}

