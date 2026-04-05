import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

import { buildAccessTokenClaims } from "../auth/access-token.claims";
import type { JwtUser } from "../auth/jwt.strategy";
import { Collection, ObjectId } from "mongodb";

import { MongoService } from "../database/mongo.service";
import { S3Service, sanitizeCategoryFolderSlug } from "./s3.service";

import {
  type AdminRole,
  type Driver,
  type Medicine,
  type Order,
  type OrderStatus,
  type User,
  type UserOrderHistory,
} from "./mock-db";

import type { PharmacistLoginDto } from "./dto/pharmacist-login.dto";
import type { PharmacistSignupDto } from "./dto/pharmacist-signup.dto";
import type { CreateMedicineDto, UpdateMedicineDto } from "./dto/medicine.dto";
import type { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import type { AssignDriverDto } from "./dto/assign-driver.dto";
import type { EmailLoginDto } from "./dto/email-login.dto";
import type { PhoneSendOtpDto } from "./dto/phone-send-otp.dto";
import type { PhoneVerifyOtpDto } from "./dto/phone-verify-otp.dto";
import type { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import type { CreateSubcategoryDto, UpdateSubcategoryDto } from "./dto/subcategory.dto";
import type { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import type { UpdateCustomerAdminDto } from "./dto/update-customer-admin.dto";
import type { CreateCustomerAdminDto } from "./dto/create-customer-admin.dto";
import type { UpdatePharmacistDto } from "./dto/update-pharmacist.dto";
import type { CreateDriverDto } from "./dto/create-driver.dto";
import type { UpdateDriverDto } from "./dto/update-driver.dto";

const DEFAULT_CATEGORY_KEY = "cat-default";
const DEFAULT_SUBCATEGORY_KEY = "subcat-default";

type CategoryDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  imageUrl?: string;
  /** Set when the image file is replaced; clients can use for cache-busting (URL may stay identical for same slug path). */
  imageUpdatedAt?: string;
  createdAt: string;
};
type SubcategoryDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  category_id: string;
  imageUrl?: string;
  imageUpdatedAt?: string;
  createdAt: string;
};
type ProductDoc = {
  _id?: ObjectId;
  id: string;
  /** Same as `id` for new records (8-digit); optional on legacy documents (falls back to `id`). */
  product_id?: string;
  /** Short display title; legacy docs may omit (API falls back to `name`). */
  title?: string;
  name: string;
  /** Primary product image URL (S3 public URL or local path). */
  image?: string;
  /** Extra gallery URLs (up to 5). */
  additional_images?: string[];
  /** @deprecated Legacy combined list; prefer `image` + `additional_images`. */
  images?: string[];
  description: string;
  price: number;
  mrp?: number;
  discount_percent?: number;
  bestSeller?: boolean;
  stockQty: number;
  pack_size?: string;
  brand?: string;
  sku?: string;
  prescription_required?: boolean;
  category_id: string;
  subcategory_id: string;
  createdAt: string;
  updatedAt?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function allocateEightDigitProductId(): string {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

const MIN_PRODUCT_DESCRIPTION_CHARS = 80;

function assertMinDescriptionLength(description: string) {
  const n = description.trim().length;
  if (n < MIN_PRODUCT_DESCRIPTION_CHARS) {
    throw new BadRequestException(
      `Description must be at least ${MIN_PRODUCT_DESCRIPTION_CHARS} characters (currently ${n})`
    );
  }
}

/**
 * If `image` is empty but extras exist (e.g. primary removed client-side), promote first extra to primary.
 */
function normalizePrimaryAndExtras(
  dtoImage: string | undefined,
  dtoExtras: string[] | undefined,
  current: { image?: string; additional_images?: string[] }
): { image: string; additional_images: string[] } {
  let primary = dtoImage !== undefined ? dtoImage.trim() : current.image?.trim() ?? "";
  let extras: string[] =
    dtoExtras !== undefined
      ? dtoExtras.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean)
      : (current.additional_images ?? [])
          .map((u) => (typeof u === "string" ? u.trim() : ""))
          .filter(Boolean);

  if (!primary && extras.length) {
    primary = extras[0];
    extras = extras.slice(1);
  }

  return { image: primary, additional_images: extras };
}

/** Resolved gallery URLs for S3 delete and API `images` (legacy `images[]` supported). */
function productMediaUrls(doc: {
  image?: string;
  additional_images?: string[];
  images?: string[];
}): string[] {
  const primary = doc.image?.trim();
  if (primary) {
    const extras = Array.isArray(doc.additional_images)
      ? doc.additional_images.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean)
      : [];
    return [primary, ...extras];
  }
  const legacy = doc.images;
  if (Array.isArray(legacy) && legacy.length) {
    return legacy.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  }
  return [];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mongo: MongoService,
    private readonly s3Service: S3Service
  ) {}

  issueToken(user: { id: string; name: string; role: AdminRole; email?: string; phone?: string }) {
    return this.jwtService.sign(
      buildAccessTokenClaims({
        userId: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        phone: user.phone,
      }),
    );
  }

  private async findUserByIdentifier(usersCol: Collection<any>, role: AdminRole, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.includes("@")) {
      return usersCol.findOne({ role, email: trimmed.toLowerCase() });
    }
    return usersCol.findOne({ role, username: trimmed });
  }

  async pharmacistUsernamePasswordLogin(dto: PharmacistLoginDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");

    const userDoc = await this.findUserByIdentifier(usersCol, "pharmacist", dto.identifier);
    if (!userDoc?.passwordHash) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, userDoc.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const user = {
      id: userDoc.username,
      name: userDoc.name,
      role: userDoc.role as AdminRole,
      email: userDoc.email,
      phone: userDoc.phone,
    };

    const token = this.issueToken(user);
    return { success: true as const, token, user };
  }

  /** Shared insert for pharmacist accounts (self-signup and admin-created). */
  private async insertPharmacistUser(dto: PharmacistSignupDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");

    const username = dto.username.trim();
    const email = dto.email.toLowerCase().trim();
    const phone = dto.phone.trim();
    const name = dto.name.trim();

    const existingUsername = await usersCol.findOne({ username });
    if (existingUsername) throw new BadRequestException("Username already exists");

    const existingEmail = await usersCol.findOne({ email });
    if (existingEmail) throw new BadRequestException("Email already in use");

    const passwordHash = bcrypt.hashSync(dto.password, 10);
    const createdAt = nowIso();

    // MongoDB `users` collection — same store as admin-seeded accounts and customers.
    const insertResult = await usersCol.insertOne({
      username,
      name,
      email,
      phone,
      passwordHash,
      role: "pharmacist",
      createdAt,
    });

    if (!insertResult.acknowledged || !insertResult.insertedId) {
      throw new BadRequestException("Could not save pharmacist to users collection");
    }

    return { id: username, name, role: "pharmacist" as const, email, phone };
  }

  async createPharmacistByAdmin(dto: PharmacistSignupDto) {
    const user = await this.insertPharmacistUser(dto);
    return { success: true as const, user };
  }

  async pharmacistSignup(dto: PharmacistSignupDto) {
    const user = await this.insertPharmacistUser(dto);
    const token = this.issueToken(user);
    return { success: true as const, token, user };
  }

  async sendPhoneOtp(_dto: PhoneSendOtpDto) {
    throw new ForbiddenException("Admin sign-in is only available via email login on the admin sign-in page.");
  }

  async verifyPhoneOtp(_dto: PhoneVerifyOtpDto) {
    throw new ForbiddenException("Admin sign-in is only available via email login on the admin sign-in page.");
  }

  async emailLogin(dto: EmailLoginDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const email = dto.email.toLowerCase().trim();
    const userDoc = await usersCol.findOne({ role: "admin", email });
    if (!userDoc?.passwordHash) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, userDoc.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const user = {
      id: userDoc.username,
      name: userDoc.name,
      role: userDoc.role as AdminRole,
      email: userDoc.email,
      phone: userDoc.phone,
    };

    const token = this.issueToken(user);
    return { success: true as const, token, user };
  }

  async googleLogin() {
    throw new ForbiddenException("Admin sign-in is only available via email login on the admin sign-in page.");
  }

  async me(jwtUser: JwtUser) {
    // Token already contains the user identity; return it as-is.
    return {
      success: true as const,
      user: {
        id: jwtUser.sub,
        name: jwtUser.name,
        role: jwtUser.role,
        email: jwtUser.email,
        phone: jwtUser.phone,
      },
    };
  }

  // Orders
  /** Cart / checkout orders that need pharmacist attention (not OTC-only). */
  private orderNeedsPharmacistReview(doc: Record<string, unknown>): boolean {
    if (doc.requiresPharmacistReview === true) return true;
    if (doc.hasCustomerPrescription === true) return true;
    const url = typeof doc.prescriptionImageUrl === "string" ? doc.prescriptionImageUrl : "";
    if (url.includes("/uploads/prescriptions/")) return true;
    return false;
  }

  async fetchOrders(status?: OrderStatus, opts?: { pharmacistQueue?: boolean }): Promise<Order[]> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const base: Record<string, unknown> = status ? { status } : {};
    if (opts?.pharmacistQueue) {
      base.$or = [
        { requiresPharmacistReview: true },
        { hasCustomerPrescription: true },
        { prescriptionImageUrl: { $regex: "^/uploads/prescriptions/" } },
      ];
    }
    const docs = await ordersCol.find(base).toArray();
    docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return docs as Order[];
  }

  async fetchOrderById(id: string, opts?: { role?: AdminRole }): Promise<Order> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const order = await ordersCol.findOne({ id });
    if (!order) throw new NotFoundException("Order not found");
    if (opts?.role === "pharmacist" && !this.orderNeedsPharmacistReview(order)) {
      throw new ForbiddenException("This order does not require pharmacist review");
    }
    return order as Order;
  }

  // Standalone prescription uploads (prescription-only flow; separate from cart orders)
  async fetchPrescriptionRequests(): Promise<any[]> {
    await this.mongo.ensureConnected();
    const col = this.mongo.collection<any>("prescriptionRequests");
    const docs = await col.find({}).toArray();
    docs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return docs;
  }

  async fetchPrescriptionRequestById(id: string): Promise<any> {
    await this.mongo.ensureConnected();
    const col = this.mongo.collection<any>("prescriptionRequests");
    const doc = await col.findOne({ id });
    if (!doc) throw new NotFoundException("Prescription request not found");
    return doc;
  }

  async approvePrescriptionRequest(id: string): Promise<any> {
    await this.mongo.ensureConnected();
    const col = this.mongo.collection<any>("prescriptionRequests");
    const updated = await col.findOneAndUpdate({ id }, { $set: { status: "Approved" } }, { returnDocument: "after" });
    if (!updated.value) throw new NotFoundException("Prescription request not found");
    return updated.value;
  }

  async rejectPrescriptionRequest(id: string): Promise<any> {
    await this.mongo.ensureConnected();
    const col = this.mongo.collection<any>("prescriptionRequests");
    const updated = await col.findOneAndUpdate({ id }, { $set: { status: "Rejected" } }, { returnDocument: "after" });
    if (!updated.value) throw new NotFoundException("Prescription request not found");
    return updated.value;
  }

  async approveOrder(id: string): Promise<Order> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const updated = await ordersCol.findOneAndUpdate(
      { id },
      { $set: { status: "Approved" } },
      { returnDocument: "after" }
    );
    if (!updated.value) throw new NotFoundException("Order not found");
    return updated.value as Order;
  }

  async rejectOrder(id: string): Promise<Order> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const updated = await ordersCol.findOneAndUpdate(
      { id },
      { $set: { status: "Rejected", deliveryJobStatus: "Unassigned" } },
      { returnDocument: "after" }
    );
    if (!updated.value) throw new NotFoundException("Order not found");
    return updated.value as Order;
  }

  async assignDriver(orderId: string, dto: AssignDriverDto): Promise<Order> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const driversCol = this.mongo.collection<any>("drivers");

    const order = await ordersCol.findOne({ id: orderId });
    if (!order) throw new NotFoundException("Order not found");

    const driver = await driversCol.findOne({ id: dto.driverId });
    if (!driver) throw new BadRequestException("Driver not found");

    const assignedDriver = {
      driverId: driver.id,
      driverName: driver.name,
      assignedAt: new Date().toISOString(),
    };

    const nextStatus = order.status === "Pending" ? "Approved" : order.status;
    await driversCol.updateOne({ id: driver.id }, { $set: { status: "Busy" } });

    const updated = await ordersCol.findOneAndUpdate(
      { id: orderId },
      {
        $set: {
          assignedDriver,
          deliveryJobStatus: "Assigned",
          status: nextStatus,
        },
      },
      { returnDocument: "after" }
    );

    if (!updated.value) throw new NotFoundException("Order not found");
    return updated.value as Order;
  }

  // Inventory
  async fetchMedicines(): Promise<Medicine[]> {
    await this.mongo.ensureConnected();
    const medicinesCol = this.mongo.collection<any>("medicines");
    const docs = await medicinesCol.find({}).toArray();
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return docs as Medicine[];
  }

  async fetchMedicineById(id: string): Promise<Medicine> {
    await this.mongo.ensureConnected();
    const medicinesCol = this.mongo.collection<any>("medicines");
    const med = await medicinesCol.findOne({ id });
    if (!med) throw new NotFoundException("Medicine not found");
    return med as Medicine;
  }

  async createMedicine(dto: CreateMedicineDto): Promise<Medicine> {
    await this.mongo.ensureConnected();
    const medicinesCol = this.mongo.collection<any>("medicines");

    const id = `m-${Math.floor(1000 + Math.random() * 9000)}`;
    const med: Medicine = { id, ...dto };
    await medicinesCol.insertOne(med);
    return med;
  }

  async updateMedicine(id: string, dto: UpdateMedicineDto): Promise<Medicine> {
    await this.mongo.ensureConnected();
    const medicinesCol = this.mongo.collection<any>("medicines");

    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.price !== undefined) update.price = dto.price;
    if (dto.stockQty !== undefined) update.stockQty = dto.stockQty;

    const updated = await medicinesCol.findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: "after" }
    );

    if (!updated.value) throw new NotFoundException("Medicine not found");
    return updated.value as Medicine;
  }

  // Users
  async fetchUsers(): Promise<User[]> {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const docs = await usersCol.find({ role: "customer" }).toArray();
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return docs.map((d: any) => ({
      id: d.username,
      name: d.name,
      phone: d.phone,
      email: d.email,
    })) as User[];
  }

  async fetchUserById(id: string): Promise<User> {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const user = await usersCol.findOne({ username: id, role: "customer" });
    if (!user) throw new NotFoundException("User not found");
    return {
      id: user.username,
      name: user.name,
      phone: user.phone,
      email: user.email,
    } as User;
  }

  async fetchUserOrderHistory(userId: string) {
    await this.mongo.ensureConnected();
    const historyCol = this.mongo.collection<UserOrderHistory>("userOrderHistory");
    const record = await historyCol.findOne({ userId });
    if (!record) return [];
    return [...record.orders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async updateCustomer(id: string, dto: UpdateCustomerAdminDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.email !== undefined) update.email = dto.email.toLowerCase().trim();
    if (dto.phone !== undefined) update.phone = dto.phone.trim();
    if (Object.keys(update).length === 0) throw new BadRequestException("No updates provided");

    if (dto.email !== undefined) {
      const taken = await usersCol.findOne({
        email: update.email,
        username: { $ne: id },
      });
      if (taken) throw new BadRequestException("Email already in use");
    }

    const res = await usersCol.findOneAndUpdate(
      { username: id, role: "customer" },
      { $set: update },
      { returnDocument: "after" }
    );
    const doc = (res as any).value as Record<string, unknown> | null;
    if (!doc) throw new NotFoundException("User not found");
    return {
      success: true as const,
      user: {
        id: doc.username as string,
        name: doc.name as string,
        phone: doc.phone as string | undefined,
        email: doc.email as string | undefined,
      },
    };
  }

  async deleteCustomer(id: string) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const deleted = await usersCol.findOneAndDelete({ username: id, role: "customer" });
    if (!deleted.value) throw new NotFoundException("User not found");
    return { success: true as const };
  }

  async createCustomer(dto: CreateCustomerAdminDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const username = dto.username.trim();
    const email = dto.email.toLowerCase().trim();
    if (await usersCol.findOne({ username })) {
      throw new BadRequestException("Username already in use");
    }
    if (await usersCol.findOne({ email })) {
      throw new BadRequestException("Email already in use");
    }
    const passwordHash = bcrypt.hashSync(dto.password, 10);
    await usersCol.insertOne({
      username,
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      email,
      role: "customer",
      passwordHash,
    });
    return {
      success: true as const,
      user: {
        id: username,
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        email,
      } as User,
    };
  }

  async fetchPharmacists() {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const docs = await usersCol.find({ role: "pharmacist" }).toArray();
    docs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return docs.map((d: any) => ({
      id: d.username,
      name: d.name,
      email: d.email,
      phone: d.phone,
    }));
  }

  async fetchPharmacistByUsername(username: string) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const doc = await usersCol.findOne({ username, role: "pharmacist" });
    if (!doc) throw new NotFoundException("Pharmacist not found");
    return {
      id: doc.username as string,
      name: doc.name as string,
      email: doc.email as string | undefined,
      phone: doc.phone as string | undefined,
    };
  }

  async updatePharmacist(username: string, dto: UpdatePharmacistDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.email !== undefined) update.email = dto.email.toLowerCase().trim();
    if (dto.phone !== undefined) update.phone = dto.phone.trim();
    if (dto.password !== undefined) update.passwordHash = bcrypt.hashSync(dto.password, 10);
    if (Object.keys(update).length === 0) throw new BadRequestException("No updates provided");

    if (dto.email !== undefined) {
      const taken = await usersCol.findOne({
        email: update.email,
        username: { $ne: username },
      });
      if (taken) throw new BadRequestException("Email already in use");
    }

    const res = await usersCol.findOneAndUpdate(
      { username, role: "pharmacist" },
      { $set: update },
      { returnDocument: "after" }
    );
    const doc = (res as any).value as Record<string, unknown> | null;
    if (!doc) throw new NotFoundException("Pharmacist not found");
    return {
      success: true as const,
      user: {
        id: doc.username as string,
        name: doc.name as string,
        email: doc.email as string | undefined,
        phone: doc.phone as string | undefined,
      },
    };
  }

  async deletePharmacist(username: string) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const deleted = await usersCol.findOneAndDelete({ username, role: "pharmacist" });
    if (!deleted.value) throw new NotFoundException("Pharmacist not found");
    return { success: true as const };
  }

  // Delivery
  async fetchDrivers(): Promise<Driver[]> {
    await this.mongo.ensureConnected();
    const driversCol = this.mongo.collection<any>("drivers");
    const docs = await driversCol.find({}).toArray();
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return docs as Driver[];
  }

  async fetchDriverById(id: string): Promise<Driver> {
    await this.mongo.ensureConnected();
    const driversCol = this.mongo.collection<any>("drivers");
    const d = await driversCol.findOne({ id });
    if (!d) throw new NotFoundException("Driver not found");
    return d as Driver;
  }

  async createDriver(dto: CreateDriverDto) {
    await this.mongo.ensureConnected();
    const driversCol = this.mongo.collection<any>("drivers");
    const usersCol = this.mongo.collection<any>("users");
    const id = dto.id.trim();
    if (await driversCol.findOne({ id })) {
      throw new BadRequestException("Driver id already exists");
    }
    if (await usersCol.findOne({ username: id })) {
      throw new BadRequestException("This id is already in use as a login username");
    }
    const status = dto.status ?? "Available";
    await driversCol.insertOne({ id, name: dto.name.trim(), status });
    await usersCol.insertOne({
      username: id,
      name: dto.name.trim(),
      role: "driver",
      passwordHash: bcrypt.hashSync(dto.password, 10),
    });
    return { success: true as const, driver: { id, name: dto.name.trim(), status } as Driver };
  }

  async updateDriver(id: string, dto: UpdateDriverDto) {
    await this.mongo.ensureConnected();
    const driversCol = this.mongo.collection<any>("drivers");
    const usersCol = this.mongo.collection<any>("users");
    const existing = await driversCol.findOne({ id });
    if (!existing) throw new NotFoundException("Driver not found");

    if (dto.name === undefined && dto.password === undefined && dto.status === undefined) {
      throw new BadRequestException("No updates provided");
    }

    const dUpdate: Record<string, unknown> = {};
    if (dto.name !== undefined) dUpdate.name = dto.name.trim();
    if (dto.status !== undefined) dUpdate.status = dto.status;
    if (Object.keys(dUpdate).length) {
      await driversCol.updateOne({ id }, { $set: dUpdate });
    }

    const userDoc = await usersCol.findOne({ username: id, role: "driver" });
    const uUpdate: Record<string, unknown> = {};
    if (dto.name !== undefined) uUpdate.name = dto.name.trim();
    if (dto.password !== undefined) uUpdate.passwordHash = bcrypt.hashSync(dto.password, 10);
    if (userDoc) {
      if (Object.keys(uUpdate).length) {
        await usersCol.updateOne({ username: id, role: "driver" }, { $set: uUpdate });
      }
    } else if (dto.password !== undefined) {
      await usersCol.insertOne({
        username: id,
        name: dto.name !== undefined ? dto.name.trim() : (existing.name as string),
        role: "driver",
        passwordHash: bcrypt.hashSync(dto.password, 10),
      });
    }

    const doc = await driversCol.findOne({ id });
    return { success: true as const, driver: doc as Driver };
  }

  async deleteDriver(id: string) {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const blocking = await ordersCol.findOne({
      "assignedDriver.driverId": id,
      deliveryJobStatus: { $in: ["Assigned", "Accepted"] },
    });
    if (blocking) {
      throw new BadRequestException("Driver has active delivery jobs. Unassign or complete them first.");
    }
    const driversCol = this.mongo.collection<any>("drivers");
    const usersCol = this.mongo.collection<any>("users");
    const delD = await driversCol.findOneAndDelete({ id });
    if (!delD.value) throw new NotFoundException("Driver not found");
    await usersCol.deleteOne({ username: id, role: "driver" });
    return { success: true as const };
  }

  async assignDelivery(dto: AssignDeliveryDto): Promise<void> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const driversCol = this.mongo.collection<any>("drivers");

    const order = await ordersCol.findOne({ id: dto.orderId });
    if (!order) throw new NotFoundException("Order not found");

    const driver = await driversCol.findOne({ id: dto.driverId });
    if (!driver) throw new BadRequestException("Driver not found");

    const assignedDriver = {
      driverId: driver.id,
      driverName: driver.name,
      assignedAt: new Date().toISOString(),
    };

    await driversCol.updateOne({ id: driver.id }, { $set: { status: "Busy" } });

    await ordersCol.updateOne(
      { id: dto.orderId },
      {
        $set: {
          assignedDriver,
          deliveryJobStatus: "Assigned",
          status: order.status === "Pending" ? "Approved" : order.status,
        },
      }
    );
  }

  /** Resolve category by logical `id` (e.g. `cat-123456`) or legacy Mongo `_id` hex string. */
  private async findCategoryByRef(ref: string): Promise<CategoryDoc | null> {
    const t = ref?.trim();
    if (!t) return null;
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const byLogical = await categoriesCol.findOne({ id: t });
    if (byLogical) return byLogical;
    if (ObjectId.isValid(t)) {
      return categoriesCol.findOne({ _id: new ObjectId(t) });
    }
    return null;
  }

  private async ensureCatalogDefaultsAndMigrations() {
    await this.mongo.ensureConnected();
    const db = this.mongo.getDb();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");

    let defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
    if (!defaultCategory) {
      await categoriesCol.insertOne({ id: DEFAULT_CATEGORY_KEY, name: "Default", createdAt: nowIso() });
      defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
    }
    if (!defaultCategory?._id) return;

    const defaultSubcategory = await subcategoriesCol.findOne({ id: DEFAULT_SUBCATEGORY_KEY });
    if (!defaultSubcategory) {
      await subcategoriesCol.insertOne({
        id: DEFAULT_SUBCATEGORY_KEY,
        name: "Default",
        category_id: defaultCategory.id,
        createdAt: nowIso(),
      });
    } else if (defaultSubcategory.category_id !== defaultCategory.id) {
      await subcategoriesCol.updateOne(
        { id: DEFAULT_SUBCATEGORY_KEY },
        { $set: { category_id: defaultCategory.id } }
      );
    }

    // Store category logical `id` on subcategories/products (migrate legacy Mongo _id strings).
    const categories = await categoriesCol.find({}).toArray();
    for (const c of categories) {
      if (!c._id) continue;
      const oid = c._id.toString();
      await subcategoriesCol.updateMany({ category_id: oid }, { $set: { category_id: c.id } });
      await productsCol.updateMany({ category_id: oid }, { $set: { category_id: c.id } });
    }

    // Legacy: rename `medicines` → `products` once. Do NOT re-seed from `medicines` when products is empty
    // (that caused deleted products to respawn from old seed data).
    try {
      const cols = await db.listCollections({}, { nameOnly: true }).toArray();
      const hasMedicines = cols.some((c) => c.name === "medicines");
      const hasProducts = cols.some((c) => c.name === "products");
      if (hasMedicines && !hasProducts) {
        await db.renameCollection("medicines", "products");
      }
    } catch {
      // Best effort only.
    }
  }

  async fetchCategories() {
    await this.ensureCatalogDefaultsAndMigrations();
    const categories = await this.mongo.collection<CategoryDoc>("categories").find({}).toArray();
    return categories
      .map((c) => ({
        _id: c._id?.toString() ?? "",
        id: c.id ?? c._id?.toString() ?? "",
        name: c.name,
        imageUrl: c.imageUrl,
        imageUpdatedAt: c.imageUpdatedAt,
        createdAt: c.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCategory(dto: CreateCategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const name = dto.name.trim();
    const exists = await categoriesCol.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") as any });
    if (exists) throw new BadRequestException("Category already exists");
    const imageUrl = dto.imageUrl.trim();
    const rec: CategoryDoc = {
      id: randomId("cat"),
      name,
      imageUrl,
      imageUpdatedAt: imageUrl ? nowIso() : undefined,
      createdAt: nowIso(),
    };
    const ins = await categoriesCol.insertOne(rec);
    return { _id: ins.insertedId.toString(), ...rec };
  }

  /** Upload to S3 first, then insert category with the returned public URL. */
  async createCategoryWithUploadedImage(nameRaw: string, buffer: Buffer, mimetype: string) {
    if (!this.s3Service.isConfigured()) {
      throw new BadRequestException(
        "Category image upload to S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials."
      );
    }
    await this.ensureCatalogDefaultsAndMigrations();
    const name = nameRaw.trim();
    if (name.length < 2) throw new BadRequestException("Category name is too short");
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const exists = await categoriesCol.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") as any });
    if (exists) throw new BadRequestException("Category already exists");

    const folderSlug = sanitizeCategoryFolderSlug(name);
    // Same S3 put as replaceCategoryImage: no per-object ACL (bucket policy for public GET).
    const imageUrl = await this.s3Service.uploadCategoryImage(buffer, mimetype, folderSlug);

    const ts = nowIso();
    const rec: CategoryDoc = {
      id: randomId("cat"),
      name,
      imageUrl,
      imageUpdatedAt: ts,
      createdAt: ts,
    };
    const ins = await categoriesCol.insertOne(rec);
    return { _id: ins.insertedId.toString(), ...rec };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const existing = await categoriesCol.findOne({ id });
    if (!existing) throw new NotFoundException("Category not found");

    if (dto.imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== dto.imageUrl) {
      await this.s3Service.deleteObjectByUrl(existing.imageUrl);
    }

    const update: Partial<CategoryDoc> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.imageUrl !== undefined) {
      update.imageUrl = dto.imageUrl.trim();
      update.imageUpdatedAt = nowIso();
    }
    const res = await categoriesCol.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new NotFoundException("Category not found");
    const doc = await categoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Category not found");
    return {
      _id: doc._id?.toString() ?? "",
      id: doc.id,
      name: doc.name,
      imageUrl: doc.imageUrl,
      imageUpdatedAt: doc.imageUpdatedAt,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Replace category image: upload new file to S3 (same key pattern as name slug), remove previous object if URL changed, then persist public URL in DB.
   */
  async replaceCategoryImage(id: string, buffer: Buffer, mimetype: string) {
    if (!this.s3Service.isConfigured()) {
      throw new BadRequestException(
        "Category image upload to S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials."
      );
    }
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const existing = await categoriesCol.findOne({ id });
    if (!existing) throw new NotFoundException("Category not found");

    const folderSlug = sanitizeCategoryFolderSlug(existing.name);
    // Same PutObject as create-with-image: no ACL (ACLs disabled on bucket → use bucket policy).
    const newPublicUrl = await this.s3Service.uploadCategoryImage(buffer, mimetype, folderSlug);

    if (existing.imageUrl && existing.imageUrl !== newPublicUrl) {
      await this.s3Service.deleteObjectByUrl(existing.imageUrl);
    }

    const imageUpdatedAt = nowIso();
    await categoriesCol.updateOne({ id }, { $set: { imageUrl: newPublicUrl, imageUpdatedAt } });
    const doc = await categoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Category not found");
    return {
      _id: doc._id?.toString() ?? "",
      id: doc.id,
      name: doc.name,
      imageUrl: doc.imageUrl,
      imageUpdatedAt: doc.imageUpdatedAt,
      createdAt: doc.createdAt,
    };
  }

  async deleteCategory(id: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    if (id === DEFAULT_CATEGORY_KEY) {
      throw new BadRequestException("The system default category cannot be deleted.");
    }

    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");

    const cat = await categoriesCol.findOne({ id });
    if (!cat?._id) throw new NotFoundException("Category not found");

    const products = await productsCol.find({ category_id: cat.id }).toArray();
    for (const p of products) {
      for (const img of productMediaUrls(p)) {
        await this.s3Service.deleteObjectByUrl(img);
      }
    }

    const subs = await subcategoriesCol.find({ category_id: cat.id }).toArray();
    for (const s of subs) {
      await this.s3Service.deleteObjectByUrl(s.imageUrl);
    }

    const folderSlug = sanitizeCategoryFolderSlug(cat.name);
    await this.s3Service.deleteAllObjectsUnderPrefix(folderSlug);
    await this.s3Service.deleteObjectByUrl(cat.imageUrl);

    await productsCol.deleteMany({ category_id: cat.id });
    await subcategoriesCol.deleteMany({ category_id: cat.id });
    await categoriesCol.deleteOne({ id });

    return { success: true as const, deletedId: id };
  }

  async fetchSubcategories(categoryId?: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    let filter: Record<string, string> = {};
    if (categoryId?.trim()) {
      const cat = await this.findCategoryByRef(categoryId.trim());
      filter = { category_id: cat?.id ?? categoryId.trim() };
    }
    const docs = await this.mongo.collection<SubcategoryDoc>("subcategories").find(filter).toArray();
    return docs
      .map((d) => ({
        _id: d._id?.toString() ?? "",
        id: d.id,
        name: d.name,
        category_id: d.category_id,
        imageUrl: d.imageUrl,
        imageUpdatedAt: d.imageUpdatedAt,
        createdAt: d.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createSubcategory(dto: CreateSubcategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const parent = await this.findCategoryByRef(dto.category_id);
    if (!parent) throw new BadRequestException("Parent category not found");

    const imageUrl = dto.imageUrl?.trim();
    const ts = nowIso();
    const rec: SubcategoryDoc = {
      id: randomId("subcat"),
      name: dto.name.trim(),
      category_id: parent.id,
      imageUrl,
      imageUpdatedAt: imageUrl ? ts : undefined,
      createdAt: ts,
    };
    const ins = await subcategoriesCol.insertOne(rec);
    return {
      _id: ins.insertedId.toString(),
      id: rec.id,
      name: rec.name,
      category_id: rec.category_id,
      imageUrl: rec.imageUrl,
      imageUpdatedAt: rec.imageUpdatedAt,
      createdAt: rec.createdAt,
    };
  }

  /** Upload to S3 at `{categorySlug}/{subcategorySlug}/{subcategorySlug}.jpeg`, then insert subcategory with public URL. */
  async createSubcategoryWithUploadedImage(nameRaw: string, categoryId: string, buffer: Buffer, mimetype: string) {
    if (!this.s3Service.isConfigured()) {
      throw new BadRequestException(
        "Subcategory image upload to S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials."
      );
    }
    await this.ensureCatalogDefaultsAndMigrations();
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const parent = await this.findCategoryByRef(categoryId);
    if (!parent) throw new BadRequestException("Parent category not found");

    const name = nameRaw.trim();
    if (name.length < 2) throw new BadRequestException("Subcategory name is too short");

    const imageUrl = await this.s3Service.uploadSubcategoryImage(buffer, mimetype, parent.name, name);
    const ts = nowIso();
    const rec: SubcategoryDoc = {
      id: randomId("subcat"),
      name,
      category_id: parent.id,
      imageUrl,
      imageUpdatedAt: ts,
      createdAt: ts,
    };
    const ins = await subcategoriesCol.insertOne(rec);
    return {
      _id: ins.insertedId.toString(),
      id: rec.id,
      name: rec.name,
      category_id: rec.category_id,
      imageUrl: rec.imageUrl,
      imageUpdatedAt: rec.imageUpdatedAt,
      createdAt: rec.createdAt,
    };
  }

  async updateSubcategory(id: string, dto: UpdateSubcategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");

    const existing = await subcategoriesCol.findOne({ id });
    if (!existing) throw new NotFoundException("Subcategory not found");

    if (dto.imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== dto.imageUrl.trim()) {
      await this.s3Service.deleteObjectByUrl(existing.imageUrl);
    }

    const update: Partial<SubcategoryDoc> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.imageUrl !== undefined) {
      update.imageUrl = dto.imageUrl.trim();
      update.imageUpdatedAt = nowIso();
    }
    if (dto.category_id !== undefined) {
      const parent = await this.findCategoryByRef(dto.category_id);
      if (!parent) throw new BadRequestException("Parent category not found");
      update.category_id = parent.id;
    }

    const res = await subcategoriesCol.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new NotFoundException("Subcategory not found");
    const doc = await subcategoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Subcategory not found");
    return {
      _id: doc._id?.toString() ?? "",
      id: doc.id,
      name: doc.name,
      category_id: doc.category_id,
      imageUrl: doc.imageUrl,
      imageUpdatedAt: doc.imageUpdatedAt,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Replace subcategory image: upload to S3 under parent category slug, delete previous object if URL changed, persist URL + imageUpdatedAt.
   */
  async replaceSubcategoryImage(id: string, buffer: Buffer, mimetype: string) {
    if (!this.s3Service.isConfigured()) {
      throw new BadRequestException(
        "Subcategory image upload to S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials."
      );
    }
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");

    const existing = await subcategoriesCol.findOne({ id });
    if (!existing) throw new NotFoundException("Subcategory not found");
    const parent = await this.findCategoryByRef(existing.category_id);
    if (!parent) throw new BadRequestException("Parent category not found");

    const newPublicUrl = await this.s3Service.uploadSubcategoryImage(buffer, mimetype, parent.name, existing.name);

    if (existing.imageUrl && existing.imageUrl !== newPublicUrl) {
      await this.s3Service.deleteObjectByUrl(existing.imageUrl);
    }

    const imageUpdatedAt = nowIso();
    await subcategoriesCol.updateOne({ id }, { $set: { imageUrl: newPublicUrl, imageUpdatedAt } });
    const doc = await subcategoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Subcategory not found");
    return {
      _id: doc._id?.toString() ?? "",
      id: doc.id,
      name: doc.name,
      category_id: doc.category_id,
      imageUrl: doc.imageUrl,
      imageUpdatedAt: doc.imageUpdatedAt,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Upload product images to the same bucket as categories:
   * `{categorySlug}/{subcategorySlug}/{product_id}/primary.jpeg`, then `1.jpeg`…`5.jpeg` for extras.
   */
  async uploadProductImagesToS3(
    files: Array<{ buffer: Buffer; mimetype: string }>,
    categoryIdRef: string,
    subcategoryLogicalId: string,
    productId: string
  ): Promise<string[]> {
    await this.ensureCatalogDefaultsAndMigrations();
    if (!files.length) throw new BadRequestException("No files uploaded");
    if (files.length > 6) throw new BadRequestException("At most 6 files: 1 primary and up to 5 additional images");
    const pid = productId?.trim();
    if (!pid) throw new BadRequestException("productId is required for product image uploads.");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const category = await this.findCategoryByRef(categoryIdRef);
    if (!category) throw new BadRequestException("Category not found");
    const subcategory = await subcategoriesCol.findOne({
      id: subcategoryLogicalId,
      category_id: category.id,
    });
    if (!subcategory) throw new BadRequestException("Subcategory not found for this category");
    return this.s3Service.uploadProductImages(files, category.name, subcategory.name, pid);
  }

  /** Upload one product image to `primary.jpeg` (slot 0) or `1.jpeg`…`5.jpeg` (slots 1–5). */
  async uploadProductImageSlotToS3(
    buffer: Buffer,
    mimetype: string,
    categoryIdRef: string,
    subcategoryLogicalId: string,
    productId: string,
    slot: number
  ): Promise<string> {
    await this.ensureCatalogDefaultsAndMigrations();
    if (slot < 0 || slot > 5) throw new BadRequestException("slot must be between 0 and 5");
    if (!buffer?.length) throw new BadRequestException("No file uploaded");
    const pid = productId?.trim();
    if (!pid) throw new BadRequestException("productId is required");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const category = await this.findCategoryByRef(categoryIdRef);
    if (!category) throw new BadRequestException("Category not found");
    const subcategory = await subcategoriesCol.findOne({
      id: subcategoryLogicalId,
      category_id: category.id,
    });
    if (!subcategory) throw new BadRequestException("Subcategory not found for this category");
    return this.s3Service.uploadProductImageAtSlot(buffer, mimetype, category.name, subcategory.name, pid, slot);
  }

  private async fetchProductImageBuffer(src: string): Promise<Buffer> {
    const t = src.trim();
    if (!t) throw new BadRequestException("Empty image URL");
    if (t.startsWith("http://") || t.startsWith("https://")) {
      const res = await fetch(t);
      if (!res.ok) throw new BadRequestException(`Failed to fetch image (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
    const rel = t.startsWith("/") ? t.slice(1) : t;
    const fp = path.join(process.cwd(), rel);
    if (!fs.existsSync(fp)) throw new BadRequestException("Image file not found on server");
    return fs.readFileSync(fp);
  }

  /**
   * When primary/additional order changes, re-upload so S3 has `primary.jpeg` + `1.jpeg`… in that order,
   * then return the new public URLs for Mongo `image` / `additional_images`.
   */
  private async syncOrderedProductImagesToS3(
    orderedSourceUrls: string[],
    categoryIdRef: string,
    subcategoryLogicalId: string,
    productFolderId: string
  ): Promise<string[]> {
    if (!this.s3Service.isConfigured()) {
      return [...orderedSourceUrls];
    }
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const category = await this.findCategoryByRef(categoryIdRef);
    if (!category) throw new BadRequestException("Parent category not found");
    const subcategory = await subcategoriesCol.findOne({
      id: subcategoryLogicalId,
      category_id: category.id,
    });
    if (!subcategory) throw new BadRequestException("Subcategory not found for selected category");

    const pid = productFolderId?.trim();
    if (!pid) throw new BadRequestException("product id is required for image sync");

    const out: string[] = [];
    for (let i = 0; i < orderedSourceUrls.length; i++) {
      const buf = await this.fetchProductImageBuffer(orderedSourceUrls[i]);
      const url = await this.s3Service.uploadProductImageAtSlot(
        buf,
        "image/jpeg",
        category.name,
        subcategory.name,
        pid,
        i
      );
      out.push(url);
    }
    await this.s3Service.deleteUnusedProductImageSlots(
      category.name,
      subcategory.name,
      pid,
      orderedSourceUrls.length
    );
    return out;
  }

  /** Reserve a unique 8-digit id before upload + create (same as persisted `product_id` / `id`). */
  async allocateProductId(): Promise<{ product_id: string }> {
    await this.ensureCatalogDefaultsAndMigrations();
    const productsCol = this.mongo.collection<ProductDoc>("products");
    for (let attempt = 0; attempt < 48; attempt++) {
      const product_id = allocateEightDigitProductId();
      const taken = await productsCol.findOne({ id: product_id });
      if (!taken) return { product_id };
    }
    throw new BadRequestException("Could not allocate a unique product id");
  }

  private normalizeProductDoc(doc: ProductDoc): ProductDoc & { product_id: string; title: string; images: string[] } {
    const product_id = doc.product_id ?? doc.id;
    const images = productMediaUrls(doc);
    const title = (doc.title?.trim() || doc.name).trim();
    return { ...doc, product_id, title, images };
  }

  async fetchProducts() {
    await this.ensureCatalogDefaultsAndMigrations();
    const docs = await this.mongo.collection<ProductDoc>("products").find({}).toArray();
    docs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return docs.map((d) => this.normalizeProductDoc(d as ProductDoc));
  }

  async fetchProductById(id: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    const doc = await this.mongo.collection<ProductDoc>("products").findOne({ id });
    if (!doc) throw new NotFoundException("Product not found");
    return this.normalizeProductDoc(doc as ProductDoc);
  }

  async createProduct(dto: CreateProductDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");

    const category = await this.findCategoryByRef(dto.category_id);
    if (!category) throw new BadRequestException("Parent category not found");
    const subcategory = await subcategoriesCol.findOne({
      id: dto.subcategory_id,
      category_id: category.id,
    });
    if (!subcategory) throw new BadRequestException("Subcategory not found for selected category");

    assertMinDescriptionLength(dto.description.trim());

    let id: string;
    let product_id: string;
    if (dto.product_id?.trim()) {
      id = dto.product_id.trim();
      if (!/^\d{8}$/.test(id)) throw new BadRequestException("product_id must be exactly 8 digits");
      product_id = id;
      const exists = await productsCol.findOne({ id });
      if (exists) throw new BadRequestException("This product id is already in use. Allocate a new id and try again.");
    } else {
      let chosen: string | null = null;
      for (let attempt = 0; attempt < 48; attempt++) {
        const cand = allocateEightDigitProductId();
        const taken = await productsCol.findOne({ id: cand });
        if (!taken) {
          chosen = cand;
          break;
        }
      }
      if (!chosen) throw new BadRequestException("Could not allocate a unique product id");
      id = chosen;
      product_id = chosen;
    }

    const extras = dto.additional_images?.length ? dto.additional_images : [];

    const rec: ProductDoc = {
      id,
      product_id,
      title: dto.title.trim(),
      name: dto.name.trim(),
      image: dto.image.trim(),
      additional_images: extras,
      description: dto.description.trim(),
      price: dto.price,
      mrp: dto.mrp,
      discount_percent: dto.discount_percent,
      bestSeller: dto.bestSeller ?? false,
      stockQty: dto.stockQty,
      pack_size: dto.pack_size,
      brand: dto.brand,
      sku: dto.sku,
      prescription_required: dto.prescription_required,
      category_id: category.id,
      subcategory_id: dto.subcategory_id,
      createdAt: nowIso(),
    };

    await productsCol.insertOne(rec);
    return this.normalizeProductDoc(rec);
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");
    const current = await productsCol.findOne({ id });
    if (!current) throw new NotFoundException("Product not found");

    const nextCategoryId = dto.category_id ?? current.category_id;
    const nextSubcategoryId = dto.subcategory_id ?? current.subcategory_id;
    const productFolderId = current.product_id ?? current.id;

    if (dto.description !== undefined) {
      assertMinDescriptionLength(dto.description.trim());
    }

    const update: Partial<ProductDoc> = { updatedAt: nowIso() };
    if (dto.title !== undefined) update.title = dto.title.trim();
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.image !== undefined || dto.additional_images !== undefined) {
      const { image: normImage, additional_images: normExtras } = normalizePrimaryAndExtras(
        dto.image,
        dto.additional_images,
        current
      );
      if (!normImage) {
        throw new BadRequestException("At least one product image is required");
      }
      const ordered = [normImage, ...normExtras];
      const synced = await this.syncOrderedProductImagesToS3(
        ordered,
        nextCategoryId,
        nextSubcategoryId,
        productFolderId
      );
      update.image = synced[0];
      update.additional_images = synced.slice(1);

      const folderChanged =
        nextCategoryId !== current.category_id || nextSubcategoryId !== current.subcategory_id;
      if (this.s3Service.isConfigured() && folderChanged) {
        const oldCat = await this.findCategoryByRef(current.category_id);
        const newCat = await this.findCategoryByRef(nextCategoryId);
        const oldSub =
          oldCat &&
          (await subcategoriesCol.findOne({
            id: current.subcategory_id,
            category_id: oldCat.id,
          }));
        const newSub =
          newCat &&
          (await subcategoriesCol.findOne({
            id: nextSubcategoryId,
            category_id: newCat.id,
          }));
        if (oldCat && oldSub && newCat && newSub) {
          const oldPrefix = this.s3Service.productImageFolderPrefix(oldCat.name, oldSub.name, productFolderId);
          const newPrefix = this.s3Service.productImageFolderPrefix(newCat.name, newSub.name, productFolderId);
          if (oldPrefix !== newPrefix) {
            await this.s3Service.deleteAllObjectsUnderPrefix(oldPrefix);
          }
        }
      }
    }
    if (dto.description !== undefined) update.description = dto.description.trim();
    if (dto.price !== undefined) update.price = dto.price;
    if (dto.mrp !== undefined) update.mrp = dto.mrp;
    if (dto.discount_percent !== undefined) update.discount_percent = dto.discount_percent;
    if (dto.stockQty !== undefined) update.stockQty = dto.stockQty;
    if (dto.pack_size !== undefined) update.pack_size = dto.pack_size?.trim();
    if (dto.brand !== undefined) update.brand = dto.brand?.trim();
    if (dto.sku !== undefined) update.sku = dto.sku?.trim();
    if (dto.prescription_required !== undefined) update.prescription_required = dto.prescription_required;
    if (dto.bestSeller !== undefined) update.bestSeller = dto.bestSeller;

    if (dto.category_id !== undefined || dto.subcategory_id !== undefined) {
      const category = await this.findCategoryByRef(nextCategoryId);
      if (!category) throw new BadRequestException("Parent category not found");
      const subcategory = await subcategoriesCol.findOne({
        id: nextSubcategoryId,
        category_id: category.id,
      });
      if (!subcategory) throw new BadRequestException("Subcategory not found for selected category");
      update.category_id = category.id;
      update.subcategory_id = nextSubcategoryId;
    }

    const unsetLegacyImages = dto.image !== undefined || dto.additional_images !== undefined;
    const res = await productsCol.updateOne(
      { id },
      unsetLegacyImages ? { $set: update, $unset: { images: "" } } : { $set: update }
    );
    if (res.matchedCount === 0) throw new NotFoundException("Product not found");
    const doc = await productsCol.findOne({ id });
    if (!doc) throw new NotFoundException("Product not found");
    return this.normalizeProductDoc(doc as ProductDoc);
  }

  async deleteProduct(id: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    const productsCol = this.mongo.collection<ProductDoc>("products");
    const doc = await productsCol.findOne({ id });
    if (!doc) throw new NotFoundException("Product not found");
    for (const img of productMediaUrls(doc)) {
      await this.s3Service.deleteObjectByUrl(img);
    }
    await productsCol.deleteOne({ id });
    return { success: true as const, deletedId: id };
  }

  async deleteSubcategory(id: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    if (id === DEFAULT_SUBCATEGORY_KEY) {
      throw new BadRequestException("The system default subcategory cannot be deleted.");
    }
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");
    const sub = await subcategoriesCol.findOne({ id });
    if (!sub) throw new NotFoundException("Subcategory not found");

    const prods = await productsCol.find({ subcategory_id: id }).toArray();
    for (const p of prods) {
      for (const img of productMediaUrls(p)) {
        await this.s3Service.deleteObjectByUrl(img);
      }
    }
    await productsCol.deleteMany({ subcategory_id: id });
    await this.s3Service.deleteObjectByUrl(sub.imageUrl);
    await subcategoriesCol.deleteOne({ id });
    return { success: true as const, deletedId: id };
  }
}

