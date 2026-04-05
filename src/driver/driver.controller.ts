import { Body, Controller, Get, Post, Req, Res, Param } from "@nestjs/common";
import type { Request, Response } from "express";

import { setTokenCookieIfPresent } from "../auth/auth-cookie";
import { Public } from "../auth/public.decorator";
import { DriverService } from "./driver.service";
import type { JwtUser } from "../auth/jwt.strategy";
import type { DriverLoginDto } from "./dto/driver-login.dto";
import { Roles } from "../auth/roles.decorator";

@Controller("driver")
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Public()
  @Post("auth/login")
  async login(@Body() dto: DriverLoginDto, @Res({ passthrough: true }) res: Response) {
    const body = await this.driverService.login(dto);
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Roles("driver")
  @Get("jobs/assigned")
  fetchAssignedJobs(
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.driverService.fetchAssignedJobs(req.user);
  }

  @Roles("driver")
  @Post("jobs/:orderId/accept")
  acceptJob(
    @Param("orderId") orderId: string,
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.driverService.acceptJob(orderId, req.user);
  }
}

