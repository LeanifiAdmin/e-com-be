import { Body, Controller, Get, Post, Req, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";

import { DriverService } from "./driver.service";
import type { JwtUser } from "../auth/jwt.strategy";
import type { DriverLoginDto } from "./dto/driver-login.dto";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";

@Controller("driver")
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Post("auth/login")
  login(@Body() dto: DriverLoginDto) {
    return this.driverService.login(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("driver")
  @Get("jobs/assigned")
  fetchAssignedJobs(
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.driverService.fetchAssignedJobs(req.user);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("driver")
  @Post("jobs/:orderId/accept")
  acceptJob(
    @Param("orderId") orderId: string,
    @Req() req: Request & { user: JwtUser }
  ) {
    return this.driverService.acceptJob(orderId, req.user);
  }
}

