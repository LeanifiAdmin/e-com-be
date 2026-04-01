import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";

import { MongoService } from "../database/mongo.service";

import {
  type AdminRole,
  type Driver,
  type Medicine,
  type Order,
  type OrderStatus,
  type User,
  type UserOrderHistory,
} from "./mock-db";

import type { AdminLoginDto } from "./dto/admin-login.dto";
import type { CreateMedicineDto, UpdateMedicineDto } from "./dto/medicine.dto";
import type { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import type { AssignDriverDto } from "./dto/assign-driver.dto";
import type { EmailLoginDto } from "./dto/email-login.dto";
import type { PhoneSendOtpDto } from "./dto/phone-send-otp.dto";
import type { PhoneVerifyOtpDto } from "./dto/phone-verify-otp.dto";
import type { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import type { CreateSubcategoryDto, UpdateSubcategoryDto } from "./dto/subcategory.dto";
import type { CreateProductDto, UpdateProductDto } from "./dto/product.dto";

type JwtPayload = { sub: string; role: AdminRole; name: string };

type OtpRecord = { otp: string; expiresAt: number };

const OTP_TTL_MS = 5 * 60 * 1000;
const otpByPhone = new Map<string, OtpRecord>();
const DEFAULT_CATEGORY_KEY = "cat-default";
const DEFAULT_SUBCATEGORY_KEY = "subcat-default";

type CategoryDoc = { _id?: ObjectId; id: string; name: string; imageUrl?: string; createdAt: string };
type SubcategoryDoc = { _id?: ObjectId; id: string; name: string; category_id: string; imageUrl?: string; createdAt: string };
type ProductDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  images: string[];
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

function normalizePhone(phone: string) {
  // Strip spaces and non-digits except leading +.
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits;
}

function roleFromPhone(phone: string): AdminRole {
  const normalized = normalizePhone(phone);
  return normalized.endsWith("0") ? "staff" : "admin";
}

function roleFromEmail(email: string): AdminRole {
  return email.toLowerCase().startsWith("staff") ? "staff" : "admin";
}

function createAdminUser(role: AdminRole) {
  if (role === "staff") {
    return { id: "staff", name: "Staff User", role, email: "staff@leanifi.com", phone: "+91 9876541000" };
  }
  return { id: "admin", name: "Admin User", role, email: "admin@leanifi.com", phone: "+91 9876541009" };
}

function generateOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

@Injectable()
export class AdminService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mongo: MongoService
  ) {}

  issueToken(user: { id: string; name: string; role: AdminRole }) {
    const payload: JwtPayload = { sub: user.id, role: user.role, name: user.name };
    return this.jwtService.sign(payload);
  }

  async usernamePasswordLogin(dto: AdminLoginDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<any>("users");
    const userDoc = await usersCol.findOne({
      username: dto.username,
      role: { $in: ["admin", "staff"] },
    });
    if (!userDoc) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, userDoc.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const user = {
      id: userDoc.username,
      name: userDoc.name,
      role: userDoc.role as AdminRole,
    };

    const token = this.issueToken(user);
    return { success: true as const, token, user };
  }

  async sendPhoneOtp(dto: PhoneSendOtpDto) {
    const otp = generateOtp6();
    const phone = normalizePhone(dto.phone);
    otpByPhone.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS });
    return { success: true as const, otp, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
  }

  async verifyPhoneOtp(dto: PhoneVerifyOtpDto) {
    const phone = normalizePhone(dto.phone);
    const rec = otpByPhone.get(phone);
    if (!rec) throw new UnauthorizedException("OTP session expired");
    if (Date.now() > rec.expiresAt) throw new UnauthorizedException("OTP expired");
    if (dto.otp !== rec.otp) throw new UnauthorizedException("Invalid OTP");

    const role = roleFromPhone(dto.phone);
    const user = createAdminUser(role);
    const token = this.issueToken(user);
    otpByPhone.delete(phone);

    return { success: true as const, token, user };
  }

  async emailLogin(dto: EmailLoginDto) {
    // Demo validation only.
    const role = roleFromEmail(dto.email);
    const user = createAdminUser(role);
    const token = this.issueToken(user);
    return { success: true as const, token, user: { ...user, email: dto.email } };
  }

  async googleLogin() {
    const role: AdminRole = "admin";
    const user = createAdminUser(role);
    const token = this.issueToken(user);
    return { success: true as const, token, user };
  }

  async me(jwtUser: JwtPayload) {
    const role = jwtUser.role;
    const user = createAdminUser(role);
    return { success: true as const, user: { ...user, id: jwtUser.sub, name: jwtUser.name } };
  }

  // Orders
  async fetchOrders(status?: OrderStatus): Promise<Order[]> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const filter = status ? { status } : {};
    const docs = await ordersCol.find(filter).toArray();
    docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return docs as Order[];
  }

  async fetchOrderById(id: string): Promise<Order> {
    await this.mongo.ensureConnected();
    const ordersCol = this.mongo.collection<any>("orders");
    const order = await ordersCol.findOne({ id });
    if (!order) throw new NotFoundException("Order not found");
    return order as Order;
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

  // Delivery
  async fetchDrivers(): Promise<Driver[]> {
    await this.mongo.ensureConnected();
    const driversCol = this.mongo.collection<any>("drivers");
    const docs = await driversCol.find({}).toArray();
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return docs as Driver[];
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

  private async ensureCatalogDefaultsAndMigrations() {
    await this.mongo.ensureConnected();
    const db = this.mongo.getDb();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");

    let defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
    if (!defaultCategory) {
      await categoriesCol.insertOne({ id: DEFAULT_CATEGORY_KEY, name: "Default", createdAt: nowIso() });
      defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
    }
    if (!defaultCategory?._id) return;

    const defaultCategoryObjectId = defaultCategory._id.toString();

    const defaultSubcategory = await subcategoriesCol.findOne({ id: DEFAULT_SUBCATEGORY_KEY });
    if (!defaultSubcategory) {
      await subcategoriesCol.insertOne({
        id: DEFAULT_SUBCATEGORY_KEY,
        name: "Default",
        category_id: defaultCategoryObjectId,
        createdAt: nowIso(),
      });
    } else if (defaultSubcategory.category_id !== defaultCategoryObjectId) {
      await subcategoriesCol.updateOne(
        { id: DEFAULT_SUBCATEGORY_KEY },
        { $set: { category_id: defaultCategoryObjectId } }
      );
    }

    // Migrate legacy subcategories where category_id stored category `id` key.
    const categories = await categoriesCol.find({}).toArray();
    for (const c of categories) {
      if (!c._id) continue;
      await subcategoriesCol.updateMany(
        { category_id: c.id },
        { $set: { category_id: c._id.toString() } }
      );
    }

    // Ensure products collection exists (legacy medicines rename/copy best effort)
    try {
      const cols = await db.listCollections({}, { nameOnly: true }).toArray();
      const hasMedicines = cols.some((c) => c.name === "medicines");
      const hasProducts = cols.some((c) => c.name === "products");
      if (hasMedicines && !hasProducts) {
        await db.renameCollection("medicines", "products");
      } else if (hasMedicines && hasProducts) {
        const productsCol = this.mongo.collection<ProductDoc>("products");
        const count = await productsCol.countDocuments({});
        if (count === 0) {
          const meds = await this.mongo.collection<any>("medicines").find({}).toArray();
          if (meds.length) {
            await productsCol.insertMany(
              meds.map((m) => ({
                id: m.id ?? randomId("prod"),
                name: String(m.name ?? "Unnamed product"),
                images: Array.isArray(m.images) ? m.images : [],
                description: String(m.description ?? ""),
                price: Number(m.price ?? 0),
                stockQty: Number(m.stockQty ?? 0),
                category_id: m.category_id ?? defaultCategoryObjectId,
                subcategory_id: m.subcategory_id ?? DEFAULT_SUBCATEGORY_KEY,
                createdAt: m.createdAt ?? nowIso(),
              }))
            );
          }
        }
      }
    } catch {
      // Best effort only.
    }
  }

  async fetchCategories() {
    await this.ensureCatalogDefaultsAndMigrations();
    const categories = await this.mongo.collection<CategoryDoc>("categories").find({}).toArray();
    return categories
      .map((c) => ({ _id: c._id?.toString() ?? "", id: c.id, name: c.name, imageUrl: c.imageUrl, createdAt: c.createdAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCategory(dto: CreateCategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const name = dto.name.trim();
    const exists = await categoriesCol.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") as any });
    if (exists) throw new BadRequestException("Category already exists");
    const rec: CategoryDoc = { id: randomId("cat"), name, imageUrl: dto.imageUrl, createdAt: nowIso() };
    const ins = await categoriesCol.insertOne(rec);
    return { _id: ins.insertedId.toString(), ...rec };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const update: Partial<CategoryDoc> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.imageUrl !== undefined) update.imageUrl = dto.imageUrl;
    const res = await categoriesCol.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new NotFoundException("Category not found");
    const doc = await categoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Category not found");
    return { _id: doc._id?.toString() ?? "", id: doc.id, name: doc.name, imageUrl: doc.imageUrl, createdAt: doc.createdAt };
  }

  async fetchSubcategories(categoryId?: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    const filter = categoryId ? { category_id: categoryId } : {};
    const docs = await this.mongo.collection<SubcategoryDoc>("subcategories").find(filter).toArray();
    return docs.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createSubcategory(dto: CreateSubcategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    if (!ObjectId.isValid(dto.category_id)) throw new BadRequestException("Invalid category_id");
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const parent = await categoriesCol.findOne({ _id: new ObjectId(dto.category_id) });
    if (!parent) throw new BadRequestException("Parent category not found");

    const rec: SubcategoryDoc = {
      id: randomId("subcat"),
      name: dto.name.trim(),
      category_id: dto.category_id,
      imageUrl: dto.imageUrl,
      createdAt: nowIso(),
    };
    await subcategoriesCol.insertOne(rec);
    return rec;
  }

  async updateSubcategory(id: string, dto: UpdateSubcategoryDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");

    const update: Partial<SubcategoryDoc> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.imageUrl !== undefined) update.imageUrl = dto.imageUrl;
    if (dto.category_id !== undefined) {
      if (!ObjectId.isValid(dto.category_id)) throw new BadRequestException("Invalid category_id");
      const parent = await categoriesCol.findOne({ _id: new ObjectId(dto.category_id) });
      if (!parent) throw new BadRequestException("Parent category not found");
      update.category_id = dto.category_id;
    }

    const res = await subcategoriesCol.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new NotFoundException("Subcategory not found");
    const doc = await subcategoriesCol.findOne({ id });
    if (!doc) throw new NotFoundException("Subcategory not found");
    return doc;
  }

  async fetchProducts() {
    await this.ensureCatalogDefaultsAndMigrations();
    const docs = await this.mongo.collection<ProductDoc>("products").find({}).toArray();
    docs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return docs;
  }

  async fetchProductById(id: string) {
    await this.ensureCatalogDefaultsAndMigrations();
    const doc = await this.mongo.collection<ProductDoc>("products").findOne({ id });
    if (!doc) throw new NotFoundException("Product not found");
    return doc;
  }

  async createProduct(dto: CreateProductDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    if (!ObjectId.isValid(dto.category_id)) throw new BadRequestException("Invalid category_id");
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");

    const category = await categoriesCol.findOne({ _id: new ObjectId(dto.category_id) });
    if (!category) throw new BadRequestException("Parent category not found");
    const subcategory = await subcategoriesCol.findOne({ id: dto.subcategory_id, category_id: dto.category_id });
    if (!subcategory) throw new BadRequestException("Subcategory not found for selected category");

    const rec: ProductDoc = {
      id: randomId("prod"),
      name: dto.name.trim(),
      images: dto.images,
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
      category_id: dto.category_id,
      subcategory_id: dto.subcategory_id,
      createdAt: nowIso(),
    };

    await productsCol.insertOne(rec);
    return rec;
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
    const productsCol = this.mongo.collection<ProductDoc>("products");
    const current = await productsCol.findOne({ id });
    if (!current) throw new NotFoundException("Product not found");

    const update: Partial<ProductDoc> = { updatedAt: nowIso() };
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.images !== undefined) update.images = dto.images;
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

    const nextCategoryId = dto.category_id ?? current.category_id;
    const nextSubcategoryId = dto.subcategory_id ?? current.subcategory_id;
    if (dto.category_id !== undefined || dto.subcategory_id !== undefined) {
      if (!ObjectId.isValid(nextCategoryId)) throw new BadRequestException("Invalid category_id");
      const category = await categoriesCol.findOne({ _id: new ObjectId(nextCategoryId) });
      if (!category) throw new BadRequestException("Parent category not found");
      const subcategory = await subcategoriesCol.findOne({ id: nextSubcategoryId, category_id: nextCategoryId });
      if (!subcategory) throw new BadRequestException("Subcategory not found for selected category");
      update.category_id = nextCategoryId;
      update.subcategory_id = nextSubcategoryId;
    }

    const res = await productsCol.updateOne({ id }, { $set: update });
    if (res.matchedCount === 0) throw new NotFoundException("Product not found");
    const doc = await productsCol.findOne({ id });
    if (!doc) throw new NotFoundException("Product not found");
    return doc;
  }
}

