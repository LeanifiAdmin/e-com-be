import { BadRequestException, Body, Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import type { File } from "multer";
import { RolesGuard } from "../../auth/roles.guard";
import { Roles } from "../../auth/roles.decorator";
import type { Request } from "express";
import { extname, join } from "path";
import * as fs from "fs";

import type { JwtUser } from "../../auth/jwt.strategy";
import { CustomerOrdersService } from "./customer-orders.service";

import { CreateCustomerOrderDto } from "./dto/create-customer-order.dto";
import { CustomerPayDto } from "./dto/customer-pay.dto";

@Controller("customer/orders")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("customer")
export class CustomerOrdersController {
  constructor(private readonly customerOrdersService: CustomerOrdersService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("prescription", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "prescriptions");
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safeExt = extname(file.originalname).slice(0, 10);
          cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${safeExt}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const mimetype = file.mimetype || "";
        const ok = mimetype.startsWith("image/") || mimetype === "application/pdf";
        if (!ok) return cb(new BadRequestException("Prescription must be an image or PDF"), false);
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    })
  )
  async createOrder(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateCustomerOrderDto,
    @UploadedFile() prescription?: File
  ) {
    return this.customerOrdersService.createOrder(req.user, dto, prescription);
  }

  @Post(":id/pay")
  async pay(
    @Req() req: Request & { user: JwtUser },
    @Param("id") id: string,
    @Body() dto: CustomerPayDto
  ) {
    return this.customerOrdersService.payForOrder(req.user, id, dto);
  }

  @Get()
  async listOrders(@Req() req: Request & { user: JwtUser }) {
    return this.customerOrdersService.listOrders(req.user);
  }

  @Get(":id")
  async getOrderById(
    @Req() req: Request & { user: JwtUser },
    @Param("id") id: string
  ) {
    return this.customerOrdersService.getOrderById(req.user, id);
  }
}

