import { BadRequestException, Body, Controller, Get, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import type { File } from "multer";
import { extname, join } from "path";
import * as fs from "fs";

import { Roles } from "../../auth/roles.decorator";
import type { Request } from "express";
import type { JwtUser } from "../../auth/jwt.strategy";
import { CustomerPrescriptionsService } from "./customer-prescriptions.service";

@Controller("customer/prescriptions")
@Roles("customer")
export class CustomerPrescriptionsController {
  constructor(private readonly service: CustomerPrescriptionsService) {}

  @Post("standalone")
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
  async standalone(
    @Req() req: Request & { user: JwtUser },
    @Body() body: { patientName: string; phone: string; deliveryAddress: string; notes?: string },
    @UploadedFile() prescription?: File
  ) {
    if (!prescription?.filename) throw new BadRequestException("Prescription file is required");
    return this.service.submitStandalone(req.user, body, {
      filename: prescription.filename,
      originalname: prescription.originalname,
      mimetype: prescription.mimetype,
    });
  }

  @Get("mine")
  listMine(@Req() req: Request & { user: JwtUser }) {
    return this.service.listMine(req.user);
  }
}
