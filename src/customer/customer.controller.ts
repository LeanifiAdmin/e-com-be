import { Body, Controller, Get, Post, Put, Req, Res } from "@nestjs/common";

import type { Request, Response } from "express";

import { setTokenCookieIfPresent } from "../auth/auth-cookie";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";

import type { JwtUser } from "../auth/jwt.strategy";
import { CustomerService } from "./customer.service";

import { CustomerPhoneSendOtpDto } from "./dto/customer-phone-send-otp.dto";
import { CustomerPhoneVerifyOtpDto } from "./dto/customer-phone-verify-otp.dto";
import { CustomerCredentialLoginDto } from "./dto/customer-credential-login.dto";
import { CustomerEmailLoginDto } from "./dto/customer-email-login.dto";
import { UpdateCustomerProfileDto } from "./dto/update-customer-profile.dto";
import { CreateCustomerAddressDto } from "./dto/create-customer-address.dto";

@Controller("customer")
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  // Auth (send-only OTP mock for now)
  @Public()
  @Post("auth/phone/send-otp")
  sendPhoneOtp(@Body() dto: CustomerPhoneSendOtpDto) {
    return this.customerService.sendPhoneOtp(dto);
  }

  @Public()
  @Post("auth/phone/verify-otp")
  async verifyPhoneOtp(@Body() dto: CustomerPhoneVerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const body = await this.customerService.verifyPhoneOtp(dto);
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Public()
  @Post("auth/login")
  async credentialLogin(@Body() dto: CustomerCredentialLoginDto, @Res({ passthrough: true }) res: Response) {
    const body = await this.customerService.credentialLogin(dto);
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Public()
  @Post("auth/email/login")
  async emailLogin(@Body() dto: CustomerEmailLoginDto, @Res({ passthrough: true }) res: Response) {
    const body = await this.customerService.credentialLogin({
      identifier: dto.email,
      password: dto.password,
    });
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Roles("customer")
  @Get("me")
  me(@Req() req: Request & { user: JwtUser }) {
    return this.customerService.me(req.user);
  }

  @Roles("customer")
  @Put("me")
  updateMe(@Req() req: Request & { user: JwtUser }, @Body() dto: UpdateCustomerProfileDto) {
    return this.customerService.updateMe(req.user, dto);
  }

  @Roles("customer")
  @Get("addresses")
  listAddresses(@Req() req: Request & { user: JwtUser }) {
    return this.customerService.listAddresses(req.user);
  }

  @Roles("customer")
  @Post("addresses")
  createAddress(@Req() req: Request & { user: JwtUser }, @Body() dto: CreateCustomerAddressDto) {
    return this.customerService.createAddress(req.user, dto);
  }
}

