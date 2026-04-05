import { Controller, Get, Post, Res } from "@nestjs/common";
import type { Response } from "express";

import { clearAccessTokenCookie } from "./auth/auth-cookie";
import { Public } from "./auth/public.decorator";
import { AppService } from "./app.service";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Clears httpOnly session cookie (call from frontends on logout). */
  @Public()
  @Post("auth/logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearAccessTokenCookie(res);
    return { success: true as const };
  }
}
