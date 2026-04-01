import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

import type { Request } from "express";

import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";

import type { JwtUser } from "../auth/jwt.strategy";
import { CustomerService } from "./customer.service";

import { CustomerPhoneSendOtpDto } from "./dto/customer-phone-send-otp.dto";
import { CustomerPhoneVerifyOtpDto } from "./dto/customer-phone-verify-otp.dto";
import { CustomerEmailLoginDto } from "./dto/customer-email-login.dto";
import { UpdateCustomerProfileDto } from "./dto/update-customer-profile.dto";
import { CreateCustomerAddressDto } from "./dto/create-customer-address.dto";

@Controller("customer")
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // Auth (send-only OTP mock for now)
  @Post("auth/phone/send-otp")
  sendPhoneOtp(@Body() dto: CustomerPhoneSendOtpDto) {
    return this.customerService.sendPhoneOtp(dto);
  }

  @Post("auth/phone/verify-otp")
  verifyPhoneOtp(@Body() dto: CustomerPhoneVerifyOtpDto) {
    return this.customerService.verifyPhoneOtp(dto);
  }

  @Post("auth/email/login")
  emailLogin(@Body() dto: CustomerEmailLoginDto) {
    return this.customerService.emailLogin(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("customer")
  @Get("me")
  me(@Req() req: Request & { user: JwtUser }) {
    return this.customerService.me(req.user);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("customer")
  @Put("me")
  updateMe(@Req() req: Request & { user: JwtUser }, @Body() dto: UpdateCustomerProfileDto) {
    return this.customerService.updateMe(req.user, dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("customer")
  @Get("addresses")
  listAddresses(@Req() req: Request & { user: JwtUser }) {
    return this.customerService.listAddresses(req.user);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("customer")
  @Post("addresses")
  createAddress(@Req() req: Request & { user: JwtUser }, @Body() dto: CreateCustomerAddressDto) {
    return this.customerService.createAddress(req.user, dto);
  }
}

