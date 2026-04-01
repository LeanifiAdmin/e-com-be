import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { diskStorage } from "multer";
import { FilesInterceptor } from "@nestjs/platform-express";
import { extname, join } from "path";
import * as fs from "fs";

import { AdminService } from "./admin.service";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { AdminRole } from "./mock-db";
import type { OrderStatus } from "./mock-db";

import { AssignDriverDto } from "./dto/assign-driver.dto";
import { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { CreateMedicineDto } from "./dto/medicine.dto";
import { UpdateMedicineDto } from "./dto/medicine.dto";
import { EmailLoginDto } from "./dto/email-login.dto";
import { PhoneSendOtpDto } from "./dto/phone-send-otp.dto";
import { PhoneVerifyOtpDto } from "./dto/phone-verify-otp.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { CreateSubcategoryDto, UpdateSubcategoryDto } from "./dto/subcategory.dto";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";

@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("uploads/categories")
  @UseInterceptors(
    FilesInterceptor("files", 4, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "categories");
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safeBase = file.originalname
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9._-]/g, "")
            .slice(0, 80);
          cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extname(safeBase) || ""}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  uploadCategoryImages(@Req() req: Request & { files?: unknown }) {
    const files = (Array.isArray(req.files) ? req.files : []) as Array<{ filename?: string }>;
    const paths = files
      .map((f) => f.filename)
      .filter((name): name is string => Boolean(name))
      .map((name) => `/uploads/categories/${name}`);
    if (!paths.length) throw new BadRequestException("No files uploaded");
    return { success: true as const, paths };
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("uploads/subcategories")
  @UseInterceptors(
    FilesInterceptor("files", 4, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "subcategories");
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safeBase = file.originalname
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9._-]/g, "")
            .slice(0, 80);
          cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extname(safeBase) || ""}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  uploadSubcategoryImages(@Req() req: Request & { files?: unknown }) {
    const files = (Array.isArray(req.files) ? req.files : []) as Array<{ filename?: string }>;
    const paths = files
      .map((f) => f.filename)
      .filter((name): name is string => Boolean(name))
      .map((name) => `/uploads/subcategories/${name}`);
    if (!paths.length) throw new BadRequestException("No files uploaded");
    return { success: true as const, paths };
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("uploads/products")
  @UseInterceptors(
    FilesInterceptor("files", 12, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), "uploads", "products");
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const safeBase = file.originalname
            .replace(/\s+/g, "-")
            .replace(/[^a-zA-Z0-9._-]/g, "")
            .slice(0, 80);
          cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extname(safeBase) || ""}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  uploadProductImages(@Req() req: Request & { files?: unknown }) {
    const files = (Array.isArray(req.files) ? req.files : []) as Array<{ filename?: string }>;
    const paths = files
      .map((f) => f.filename)
      .filter((name): name is string => Boolean(name))
      .map((name) => `/uploads/products/${name}`);
    if (!paths.length) throw new BadRequestException("No files uploaded");
    return { success: true as const, paths };
  }

  // Auth
  @Post("auth/login")
  usernamePasswordLogin(@Body() dto: AdminLoginDto) {
    return this.adminService.usernamePasswordLogin(dto);
  }

  @Post("auth/phone/send-otp")
  sendPhoneOtp(@Body() dto: PhoneSendOtpDto) {
    return this.adminService.sendPhoneOtp(dto);
  }

  @Post("auth/phone/verify-otp")
  verifyPhoneOtp(@Body() dto: PhoneVerifyOtpDto) {
    return this.adminService.verifyPhoneOtp(dto);
  }

  @Post("auth/email/login")
  emailLogin(@Body() dto: EmailLoginDto) {
    return this.adminService.emailLogin(dto);
  }

  @Post("auth/google/login")
  googleLogin() {
    return this.adminService.googleLogin();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("me")
  me(@Req() req: Request & { user: { sub: string; role: AdminRole; name: string } }) {
    return this.adminService.me(req.user);
  }

  // Orders
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("orders")
  fetchOrders(@Query("status") status?: OrderStatus) {
    return this.adminService.fetchOrders(status);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("orders/:id")
  fetchOrderById(@Param("id") id: string) {
    return this.adminService.fetchOrderById(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("orders/:id/approve")
  approveOrder(@Param("id") id: string) {
    return this.adminService.approveOrder(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("orders/:id/reject")
  rejectOrder(@Param("id") id: string) {
    return this.adminService.rejectOrder(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("orders/:id/assign-driver")
  assignDriver(@Param("id") orderId: string, @Body() dto: AssignDriverDto) {
    return this.adminService.assignDriver(orderId, dto);
  }

  // Inventory
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("medicines")
  fetchMedicines() {
    return this.adminService.fetchMedicines();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("medicines")
  createMedicine(@Body() dto: CreateMedicineDto) {
    return this.adminService.createMedicine(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("medicines/:id")
  fetchMedicineById(@Param("id") id: string) {
    return this.adminService.fetchMedicineById(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Put("medicines/:id")
  updateMedicine(@Param("id") id: string, @Body() dto: UpdateMedicineDto) {
    return this.adminService.updateMedicine(id, dto);
  }

  // Categories / Subcategories / Products
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("categories")
  fetchCategories() {
    return this.adminService.fetchCategories();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("categories")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Put("categories/:id")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.adminService.updateCategory(id, dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("subcategories")
  fetchSubcategories(@Query("categoryId") categoryId?: string) {
    return this.adminService.fetchSubcategories(categoryId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("subcategories")
  createSubcategory(@Body() dto: CreateSubcategoryDto) {
    return this.adminService.createSubcategory(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Put("subcategories/:id")
  updateSubcategory(@Param("id") id: string, @Body() dto: UpdateSubcategoryDto) {
    return this.adminService.updateSubcategory(id, dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("products")
  fetchProducts() {
    return this.adminService.fetchProducts();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("products")
  createProduct(@Body() dto: CreateProductDto) {
    return this.adminService.createProduct(dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("products/:id")
  fetchProductById(@Param("id") id: string) {
    return this.adminService.fetchProductById(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Put("products/:id")
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.adminService.updateProduct(id, dto);
  }

  // Users
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("users")
  fetchUsers() {
    return this.adminService.fetchUsers();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("users/:id")
  fetchUserById(@Param("id") id: string) {
    return this.adminService.fetchUserById(id);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("users/:id/orders")
  fetchUserOrders(@Param("id") userId: string) {
    return this.adminService.fetchUserOrderHistory(userId);
  }

  // Delivery
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Get("drivers")
  fetchDrivers() {
    return this.adminService.fetchDrivers();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "staff")
  @Post("deliveries/assign")
  assignDelivery(@Body() dto: AssignDeliveryDto) {
    return this.adminService.assignDelivery(dto);
  }
}

