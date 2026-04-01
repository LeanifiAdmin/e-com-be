import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";

import { MongoService } from "../database/mongo.service";
import type { JwtUser } from "../auth/jwt.strategy";

import type { CustomerPhoneSendOtpDto } from "./dto/customer-phone-send-otp.dto";
import type { CustomerPhoneVerifyOtpDto } from "./dto/customer-phone-verify-otp.dto";
import type { CustomerEmailLoginDto } from "./dto/customer-email-login.dto";
import type { UpdateCustomerProfileDto } from "./dto/update-customer-profile.dto";
import type { CreateCustomerAddressDto } from "./dto/create-customer-address.dto";

type CustomerUser = { id: string; name: string; phone?: string; email?: string };

type UserDoc = {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  role: "admin" | "staff" | "driver" | "customer";
  name: string;
  phone?: string;
  email?: string;
};

type AddressDoc = {
  _id?: ObjectId;
  id: string;
  userId: string;
  deliveryAddress: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizePhoneDigits(phone: string) {
  // Keep digits only. This makes matching resilient to spaces and plus signs.
  return phone.trim().replace(/[^\d]/g, "");
}

function generateOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type OtpRecord = { otp: string; expiresAt: number };
const OTP_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class CustomerService {
  private readonly otpByPhone = new Map<string, OtpRecord>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly mongo: MongoService
  ) {}

  private issueToken(user: { id: string; name: string }) {
    const payload: JwtUser = { sub: user.id, role: "customer", name: user.name };
    return this.jwtService.sign(payload);
  }

  async sendPhoneOtp(dto: CustomerPhoneSendOtpDto) {
    await this.mongo.ensureConnected();
    const normalized = normalizePhoneDigits(dto.phone);
    if (!normalized || normalized.length < 10) throw new BadRequestException("Invalid phone");

    const otp = generateOtp6();
    this.otpByPhone.set(normalized, { otp, expiresAt: Date.now() + OTP_TTL_MS });

    // Development helper: allow local testing without an external SMS provider.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[customer-otp] phone=${normalized} otp=${otp}`);
    }

    // send-only mock: return TTL so the frontend can show expiry countdown
    return { success: true as const, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
  }

  async verifyPhoneOtp(dto: CustomerPhoneVerifyOtpDto) {
    await this.mongo.ensureConnected();
    const normalized = normalizePhoneDigits(dto.phone);
    if (!normalized || normalized.length < 10) throw new UnauthorizedException("Invalid OTP session");

    const rec = this.otpByPhone.get(normalized);
    if (!rec) throw new UnauthorizedException("OTP session expired");
    if (Date.now() > rec.expiresAt) throw new UnauthorizedException("OTP expired");
    if (dto.otp !== rec.otp) throw new UnauthorizedException("Invalid OTP");

    this.otpByPhone.delete(normalized);

    const usersCol = this.mongo.collection<UserDoc>("users");

    // Try to match existing customer by last digits to handle legacy stored formatting.
    const lastDigits = normalized.slice(-10);
    const existing = await usersCol.findOne({
      role: "customer",
      phone: { $regex: lastDigits },
    });

    let user = existing as UserDoc | null;
    if (!user) {
      const username = `c-${normalized}`;
      const passwordHash = bcrypt.hashSync(randomId("pw"), 10);
      user = await usersCol.findOneAndUpdate(
        { username },
        {
          $setOnInsert: {
            username,
            name: "Customer",
            phone: normalized,
            email: undefined,
            passwordHash,
            role: "customer",
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      const value = (user as any).value as UserDoc | null;
      user = value;
      if (!user) throw new NotFoundException("Customer not created");
    }

    if (user.role !== "customer") throw new UnauthorizedException("Invalid user role");

    const token = this.issueToken({ id: user.username, name: user.name });
    return {
      success: true as const,
      token,
      user: {
        id: user.username,
        name: user.name,
        phone: user.phone,
        email: user.email,
      } satisfies CustomerUser,
    };
  }

  async emailLogin(dto: CustomerEmailLoginDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<UserDoc>("users");
    const user = await usersCol.findOne({ role: "customer", email: dto.email.toLowerCase() });
    if (!user) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");

    const token = this.issueToken({ id: user.username, name: user.name });
    return {
      success: true as const,
      token,
      user: { id: user.username, name: user.name, phone: user.phone, email: user.email },
    };
  }

  async me(jwtUser: JwtUser) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<UserDoc>("users");
    const doc = await usersCol.findOne({ username: jwtUser.sub, role: "customer" });
    if (!doc) throw new NotFoundException("Customer not found");
    return {
      success: true as const,
      user: { id: doc.username, name: doc.name, phone: doc.phone, email: doc.email },
    };
  }

  async updateMe(jwtUser: JwtUser, dto: UpdateCustomerProfileDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<UserDoc>("users");

    const update: Partial<UserDoc> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.email !== undefined) update.email = dto.email.toLowerCase();

    if (Object.keys(update).length === 0) throw new BadRequestException("No updates provided");

    const updated = await usersCol.findOneAndUpdate(
      { username: jwtUser.sub, role: "customer" },
      { $set: update },
      { returnDocument: "after" }
    );

    const doc = (updated as any).value as UserDoc | null;
    if (!doc) throw new NotFoundException("Customer not found");

    return {
      success: true as const,
      user: { id: doc.username, name: doc.name, phone: doc.phone, email: doc.email },
    };
  }

  async listAddresses(jwtUser: JwtUser) {
    await this.mongo.ensureConnected();
    const addrCol = this.mongo.collection<AddressDoc>("customerAddresses");
    const docs = await addrCol
      .find({ userId: jwtUser.sub })
      .sort({ createdAt: -1 as any })
      .toArray();

    return {
      success: true as const,
      addresses: docs.map((d) => ({
        id: d.id,
        deliveryAddress: d.deliveryAddress,
        createdAt: d.createdAt,
      })),
    };
  }

  async createAddress(jwtUser: JwtUser, dto: CreateCustomerAddressDto) {
    await this.mongo.ensureConnected();
    const addrCol = this.mongo.collection<AddressDoc>("customerAddresses");
    const rec: AddressDoc = {
      id: randomId("addr"),
      userId: jwtUser.sub,
      deliveryAddress: dto.deliveryAddress.trim(),
      createdAt: nowIso(),
    };

    await addrCol.insertOne(rec);
    return {
      success: true as const,
      address: { id: rec.id, deliveryAddress: rec.deliveryAddress, createdAt: rec.createdAt },
    };
  }
}

