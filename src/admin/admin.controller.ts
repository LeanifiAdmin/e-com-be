import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { setTokenCookieIfPresent } from "../auth/auth-cookie";
import { diskStorage, memoryStorage } from "multer";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { extname, join } from "path";
import * as fs from "fs";

import { AdminService } from "./admin.service";
import { S3Service } from "./s3.service";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import type { JwtUser } from "../auth/jwt.strategy";
import type { AdminRole, OrderStatus } from "./mock-db";

import { AssignDriverDto } from "./dto/assign-driver.dto";
import { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import { PharmacistLoginDto } from "./dto/pharmacist-login.dto";
import { PharmacistSignupDto } from "./dto/pharmacist-signup.dto";
import { CreateMedicineDto } from "./dto/medicine.dto";
import { UpdateMedicineDto } from "./dto/medicine.dto";
import { EmailLoginDto } from "./dto/email-login.dto";
import { PhoneSendOtpDto } from "./dto/phone-send-otp.dto";
import { PhoneVerifyOtpDto } from "./dto/phone-verify-otp.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { CreateSubcategoryDto, UpdateSubcategoryDto } from "./dto/subcategory.dto";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { UpdateCustomerAdminDto } from "./dto/update-customer-admin.dto";
import { CreateCustomerAdminDto } from "./dto/create-customer-admin.dto";
import { UpdatePharmacistDto } from "./dto/update-pharmacist.dto";
import { CreateDriverDto } from "./dto/create-driver.dto";
import { UpdateDriverDto } from "./dto/update-driver.dto";

@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly s3Service: S3Service
  ) {}

  @Roles("admin")
  @Post("uploads/categories")
  @UseInterceptors(
    FilesInterceptor("files", 4, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  async uploadCategoryImages(@Req() req: Request & { files?: unknown }) {
    if (!this.s3Service.isConfigured()) {
      throw new BadRequestException(
        "Category image upload to S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials in the server environment."
      );
    }
    const files = (Array.isArray(req.files) ? req.files : []) as Array<{ buffer: Buffer; mimetype: string }>;
    if (!files.length) throw new BadRequestException("No files uploaded");
    const raw = (req as Request).query?.basename;
    const folderSlug = typeof raw === "string" && raw.trim() ? raw : undefined;
    const paths: string[] = [];
    for (const file of files) {
      if (!file.buffer?.length) throw new BadRequestException("Empty file upload");
      const url = await this.s3Service.uploadCategoryImage(file.buffer, file.mimetype, folderSlug);
      paths.push(url);
    }
    return { success: true as const, paths };
  }

  @Roles("admin")
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

  @Roles("admin")
  @Post("uploads/products")
  @UseInterceptors(
    FilesInterceptor("files", 6, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  async uploadProductImages(
    @Req() req: Request & { files?: unknown },
    @Query("categoryId") categoryId?: string,
    @Query("subcategoryId") subcategoryId?: string,
    @Query("productId") productId?: string
  ) {
    const files = (Array.isArray(req.files) ? req.files : []) as Array<{ buffer?: Buffer; mimetype: string }>;

    if (this.s3Service.isConfigured()) {
      if (!categoryId?.trim() || !subcategoryId?.trim() || !productId?.trim()) {
        throw new BadRequestException(
          "For S3 storage, categoryId, subcategoryId, and productId query parameters are required (same productId used in DB and allocate-id)."
        );
      }
      const buffers = files
        .filter((f) => f.buffer?.length)
        .map((f) => ({ buffer: f.buffer as Buffer, mimetype: f.mimetype }));
      if (!buffers.length) throw new BadRequestException("No files uploaded");
      const paths = await this.adminService.uploadProductImagesToS3(
        buffers,
        categoryId.trim(),
        subcategoryId.trim(),
        productId.trim()
      );
      return { success: true as const, paths };
    }

    // Local dev fallback: same bucket layout not available without S3 — store flat under /uploads/products.
    const diskFiles = files.filter((f) => f.buffer?.length);
    if (!diskFiles.length) throw new BadRequestException("No files uploaded");
    const dir = join(process.cwd(), "uploads", "products");
    fs.mkdirSync(dir, { recursive: true });
    const extFromMime = (m: string) =>
      m.includes("png") ? ".png" : m.includes("webp") ? ".webp" : m.includes("gif") ? ".gif" : ".jpg";
    const paths: string[] = [];
    for (const file of diskFiles) {
      const safeBase = `img-${Date.now()}-${Math.random().toString(16).slice(2)}${extFromMime(file.mimetype)}`;
      const dest = join(dir, safeBase);
      fs.writeFileSync(dest, file.buffer as Buffer);
      paths.push(`/uploads/products/${safeBase}`);
    }
    return { success: true as const, paths };
  }

  @Roles("admin")
  @Post("uploads/products/slot")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  async uploadProductImageSlot(
    @UploadedFile() file: { buffer?: Buffer; mimetype: string } | undefined,
    @Query("categoryId") categoryId?: string,
    @Query("subcategoryId") subcategoryId?: string,
    @Query("productId") productId?: string,
    @Query("slot") slotRaw?: string
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("No file uploaded");
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
      throw new BadRequestException("slot must be an integer from 0 to 5");
    }
    if (this.s3Service.isConfigured()) {
      if (!categoryId?.trim() || !subcategoryId?.trim() || !productId?.trim()) {
        throw new BadRequestException(
          "For S3 storage, categoryId, subcategoryId, productId, and slot query parameters are required."
        );
      }
      const path = await this.adminService.uploadProductImageSlotToS3(
        file.buffer as Buffer,
        file.mimetype,
        categoryId.trim(),
        subcategoryId.trim(),
        productId.trim(),
        slot
      );
      return { success: true as const, path };
    }
    const dir = join(process.cwd(), "uploads", "products");
    fs.mkdirSync(dir, { recursive: true });
    const extFromMime = (m: string) =>
      m.includes("png") ? ".png" : m.includes("webp") ? ".webp" : m.includes("gif") ? ".gif" : ".jpg";
    const safeBase = `slot-${slot}-${Date.now()}-${Math.random().toString(16).slice(2)}${extFromMime(file.mimetype)}`;
    const dest = join(dir, safeBase);
    fs.writeFileSync(dest, file.buffer as Buffer);
    return { success: true as const, path: `/uploads/products/${safeBase}` };
  }

  // Auth — admin password login is only via POST auth/email/login (admin app /login page).
  @Public()
  @Post("auth/pharmacist/login")
  async pharmacistUsernamePasswordLogin(
    @Body() dto: PharmacistLoginDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const body = await this.adminService.pharmacistUsernamePasswordLogin(dto);
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Public()
  @Post("auth/pharmacist/signup")
  pharmacistSignup(@Body() dto: PharmacistSignupDto) {
    return this.adminService.pharmacistSignup(dto);
  }

  @Public()
  @Post("auth/phone/send-otp")
  sendPhoneOtp(@Body() dto: PhoneSendOtpDto) {
    return this.adminService.sendPhoneOtp(dto);
  }

  @Public()
  @Post("auth/phone/verify-otp")
  verifyPhoneOtp(@Body() dto: PhoneVerifyOtpDto) {
    return this.adminService.verifyPhoneOtp(dto);
  }

  @Public()
  @Post("auth/email/login")
  async emailLogin(@Body() dto: EmailLoginDto, @Res({ passthrough: true }) res: Response) {
    const body = await this.adminService.emailLogin(dto);
    setTokenCookieIfPresent(res, body);
    return body;
  }

  @Public()
  @Post("auth/google/login")
  googleLogin() {
    return this.adminService.googleLogin();
  }

  @Roles("admin", "pharmacist")
  @Get("me")
  me(@Req() req: Request & { user: JwtUser }) {
    return this.adminService.me(req.user);
  }

  // Standalone prescription uploads (separate from cart orders)
  @Roles("admin", "pharmacist")
  @Get("prescription-requests")
  fetchPrescriptionRequests() {
    return this.adminService.fetchPrescriptionRequests();
  }

  @Roles("admin", "pharmacist")
  @Get("prescription-requests/:id")
  fetchPrescriptionRequestById(@Param("id") id: string) {
    return this.adminService.fetchPrescriptionRequestById(id);
  }

  @Roles("admin", "pharmacist")
  @Post("prescription-requests/:id/approve")
  approvePrescriptionRequest(@Param("id") id: string) {
    return this.adminService.approvePrescriptionRequest(id);
  }

  @Roles("admin", "pharmacist")
  @Post("prescription-requests/:id/reject")
  rejectPrescriptionRequest(@Param("id") id: string) {
    return this.adminService.rejectPrescriptionRequest(id);
  }

  // Orders
  @Roles("admin", "pharmacist")
  @Get("orders")
  fetchOrders(@Query("status") status: OrderStatus | undefined, @Req() req: Request & { user: JwtUser }) {
    const pharmacistQueue = req.user.role === "pharmacist";
    return this.adminService.fetchOrders(status, { pharmacistQueue });
  }

  @Roles("admin", "pharmacist")
  @Get("orders/:id")
  fetchOrderById(@Param("id") id: string, @Req() req: Request & { user: JwtUser }) {
    const role = req.user.role as AdminRole;
    return this.adminService.fetchOrderById(id, role === "pharmacist" ? { role: "pharmacist" } : undefined);
  }

  @Roles("admin", "pharmacist")
  @Post("orders/:id/approve")
  approveOrder(@Param("id") id: string) {
    return this.adminService.approveOrder(id);
  }

  @Roles("admin", "pharmacist")
  @Post("orders/:id/reject")
  rejectOrder(@Param("id") id: string) {
    return this.adminService.rejectOrder(id);
  }

  @Roles("admin")
  @Post("orders/:id/assign-driver")
  assignDriver(@Param("id") orderId: string, @Body() dto: AssignDriverDto) {
    return this.adminService.assignDriver(orderId, dto);
  }

  // Inventory
  @Roles("admin", "pharmacist")
  @Get("medicines")
  fetchMedicines() {
    return this.adminService.fetchMedicines();
  }

  @Roles("admin")
  @Post("medicines")
  createMedicine(@Body() dto: CreateMedicineDto) {
    return this.adminService.createMedicine(dto);
  }

  @Roles("admin", "pharmacist")
  @Get("medicines/:id")
  fetchMedicineById(@Param("id") id: string) {
    return this.adminService.fetchMedicineById(id);
  }

  @Roles("admin")
  @Put("medicines/:id")
  updateMedicine(@Param("id") id: string, @Body() dto: UpdateMedicineDto) {
    return this.adminService.updateMedicine(id, dto);
  }

  // Categories / Subcategories / Products
  @Roles("admin", "pharmacist")
  @Get("categories")
  fetchCategories() {
    return this.adminService.fetchCategories();
  }

  @Roles("admin")
  @Post("categories")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Roles("admin")
  @Post("categories/with-image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
    })
  )
  createCategoryWithImage(@Body("name") name: string, @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException("Image file is required");
    return this.adminService.createCategoryWithUploadedImage(name ?? "", file.buffer, file.mimetype);
  }

  @Roles("admin")
  @Put("categories/:id/image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
    })
  )
  replaceCategoryImage(
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("Image file is required");
    return this.adminService.replaceCategoryImage(id, file.buffer, file.mimetype);
  }

  @Roles("admin")
  @Put("categories/:id")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.adminService.updateCategory(id, dto);
  }

  @Roles("admin")
  @Delete("categories/:id")
  deleteCategory(@Param("id") id: string) {
    return this.adminService.deleteCategory(id);
  }

  @Roles("admin", "pharmacist")
  @Get("subcategories")
  fetchSubcategories(@Query("categoryId") categoryId?: string) {
    return this.adminService.fetchSubcategories(categoryId);
  }

  @Roles("admin")
  @Post("subcategories")
  createSubcategory(@Body() dto: CreateSubcategoryDto) {
    return this.adminService.createSubcategory(dto);
  }

  @Roles("admin")
  @Post("subcategories/with-image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
    })
  )
  createSubcategoryWithImage(
    @Body("name") name: string,
    @Body("category_id") categoryId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("Image file is required");
    if (!categoryId?.trim()) throw new BadRequestException("category_id is required");
    return this.adminService.createSubcategoryWithUploadedImage(name ?? "", categoryId.trim(), file.buffer, file.mimetype);
  }

  @Roles("admin")
  @Put("subcategories/:id/image")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype?.startsWith("image/")) return cb(new BadRequestException("Only image uploads allowed"), false);
        cb(null, true);
      },
    })
  )
  replaceSubcategoryImage(
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("Image file is required");
    return this.adminService.replaceSubcategoryImage(id, file.buffer, file.mimetype);
  }

  @Roles("admin")
  @Put("subcategories/:id")
  updateSubcategory(@Param("id") id: string, @Body() dto: UpdateSubcategoryDto) {
    return this.adminService.updateSubcategory(id, dto);
  }

  @Roles("admin")
  @Delete("subcategories/:id")
  deleteSubcategory(@Param("id") id: string) {
    return this.adminService.deleteSubcategory(id);
  }

  @Roles("admin", "pharmacist")
  @Get("products")
  fetchProducts() {
    return this.adminService.fetchProducts();
  }

  @Roles("admin")
  @Post("products/allocate-id")
  allocateProductId() {
    return this.adminService.allocateProductId();
  }

  @Roles("admin")
  @Post("products")
  createProduct(@Body() dto: CreateProductDto) {
    return this.adminService.createProduct(dto);
  }

  @Roles("admin", "pharmacist")
  @Get("products/:id")
  fetchProductById(@Param("id") id: string) {
    return this.adminService.fetchProductById(id);
  }

  @Roles("admin")
  @Put("products/:id")
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.adminService.updateProduct(id, dto);
  }

  @Roles("admin")
  @Delete("products/:id")
  deleteProduct(@Param("id") id: string) {
    return this.adminService.deleteProduct(id);
  }

  // Users & staff (admin only — pharmacists must not list customers or manage staff)
  @Roles("admin")
  @Post("users")
  createCustomer(@Body() dto: CreateCustomerAdminDto) {
    return this.adminService.createCustomer(dto);
  }

  @Roles("admin")
  @Get("users")
  fetchUsers() {
    return this.adminService.fetchUsers();
  }

  @Roles("admin")
  @Get("users/:id")
  fetchUserById(@Param("id") id: string) {
    return this.adminService.fetchUserById(id);
  }

  @Roles("admin")
  @Get("users/:id/orders")
  fetchUserOrders(@Param("id") userId: string) {
    return this.adminService.fetchUserOrderHistory(userId);
  }

  @Roles("admin")
  @Put("users/:id")
  updateCustomer(@Param("id") id: string, @Body() dto: UpdateCustomerAdminDto) {
    return this.adminService.updateCustomer(id, dto);
  }

  @Roles("admin")
  @Delete("users/:id")
  deleteCustomer(@Param("id") id: string) {
    return this.adminService.deleteCustomer(id);
  }

  @Roles("admin")
  @Get("pharmacists")
  fetchPharmacists() {
    return this.adminService.fetchPharmacists();
  }

  @Roles("admin")
  @Get("pharmacists/:username")
  fetchPharmacistByUsername(@Param("username") username: string) {
    return this.adminService.fetchPharmacistByUsername(username);
  }

  @Roles("admin")
  @Post("pharmacists")
  createPharmacist(@Body() dto: PharmacistSignupDto) {
    return this.adminService.createPharmacistByAdmin(dto);
  }

  @Roles("admin")
  @Put("pharmacists/:username")
  updatePharmacist(@Param("username") username: string, @Body() dto: UpdatePharmacistDto) {
    return this.adminService.updatePharmacist(username, dto);
  }

  @Roles("admin")
  @Delete("pharmacists/:username")
  deletePharmacist(@Param("username") username: string) {
    return this.adminService.deletePharmacist(username);
  }

  // Delivery — driver directory: admin only (pharmacists review prescriptions on orders; admins assign drivers).
  @Roles("admin")
  @Get("drivers")
  fetchDrivers() {
    return this.adminService.fetchDrivers();
  }

  @Roles("admin")
  @Get("drivers/:id")
  fetchDriverById(@Param("id") id: string) {
    return this.adminService.fetchDriverById(id);
  }

  @Roles("admin")
  @Post("drivers")
  createDriver(@Body() dto: CreateDriverDto) {
    return this.adminService.createDriver(dto);
  }

  @Roles("admin")
  @Put("drivers/:id")
  updateDriver(@Param("id") id: string, @Body() dto: UpdateDriverDto) {
    return this.adminService.updateDriver(id, dto);
  }

  @Roles("admin")
  @Delete("drivers/:id")
  deleteDriver(@Param("id") id: string) {
    return this.adminService.deleteDriver(id);
  }

  @Roles("admin")
  @Post("deliveries/assign")
  assignDelivery(@Body() dto: AssignDeliveryDto) {
    return this.adminService.assignDelivery(dto);
  }
}

