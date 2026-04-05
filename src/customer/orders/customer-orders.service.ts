import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";

import { MongoService } from "../../database/mongo.service";

import type { JwtUser } from "../../auth/jwt.strategy";

import type { CreateCustomerOrderDto } from "./dto/create-customer-order.dto";
import type { CustomerPayDto, PaymentMethod } from "./dto/customer-pay.dto";

type ProductDoc = {
  id: string;
  name: string;
  description?: string;
  price: number;
  stockQty: number;
  prescription_required?: boolean;
};

type OrderDoc = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress: string;
  notes?: string;
  status: "Pending" | "Approved" | "Rejected";
  date: string;
  prescriptionImageUrl: string;
  /** True when the customer uploaded a file (not the placeholder image). */
  hasCustomerPrescription?: boolean;
  /** Cart orders that need pharmacist review: uploaded Rx and/or cart contains Rx-required medicines. */
  requiresPharmacistReview?: boolean;
  paymentStatus: "Pending" | "Paid";
  paymentMethod?: PaymentMethod;
  paymentRef?: string;
  assignedDriver?: {
    driverId: string;
    driverName: string;
    assignedAt: string;
  };
  deliveryJobStatus?: "Unassigned" | "Assigned" | "Accepted";
  deliveryAcceptedAt?: string;
  items?: Array<{ productId: string; quantity: number }>;
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function normalizePhoneDigits(phone: string) {
  return phone.trim().replace(/[^\d]/g, "");
}

type PrescriptionUpload = { filename: string; originalname: string; mimetype: string };

@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly mongo: MongoService
  ) {}

  async createOrder(jwtUser: JwtUser, dto: CreateCustomerOrderDto, prescription?: PrescriptionUpload) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    await this.mongo.ensureConnected();

    const items = dto.items ?? [];
    if (!items.length) throw new BadRequestException("Cart items are required");

    const productsCol = this.mongo.collection<ProductDoc>("products");

    // Fetch products to validate prescription requirements and stock.
    const productIds = items.map((i) => i.productId);
    const productsById = new Map<string, ProductDoc>();
    for (const pid of productIds) {
      const p = await productsCol.findOne({ id: pid });
      if (!p) throw new BadRequestException(`Product not found: ${pid}`);
      productsById.set(pid, p);
    }

    const needsPrescription = items.some((i) => productsById.get(i.productId)?.prescription_required);
    if (needsPrescription && !prescription) {
      throw new BadRequestException("Prescription required to purchase one or more items");
    }

    const hasCustomerPrescription = Boolean(prescription);
    const prescriptionImageUrl = hasCustomerPrescription
      ? `/uploads/prescriptions/${prescription!.filename}`
      : "/images/prescription-placeholder.svg";
    const requiresPharmacistReview = hasCustomerPrescription || needsPrescription;

    // Stock decrement with rollback (best effort for demo).
    const decremented: Array<{ productId: string; quantity: number }> = [];
    for (const it of items) {
      const qty = it.quantity;
      if (qty <= 0) throw new BadRequestException("Invalid quantity");

      const res = await productsCol.updateOne(
        { id: it.productId, stockQty: { $gte: qty } },
        { $inc: { stockQty: -qty } }
      );

      if (res.matchedCount !== 1) {
        // rollback previous items
        for (const d of decremented) {
          await productsCol.updateOne({ id: d.productId }, { $inc: { stockQty: d.quantity } });
        }
        throw new BadRequestException(`Insufficient stock for product ${it.productId}`);
      }

      decremented.push({ productId: it.productId, quantity: qty });
    }

    const orderId = `LF-${Math.floor(1000 + Math.random() * 9000)}`;

    const ordersCol = this.mongo.collection<OrderDoc>("orders");
    const order: OrderDoc = {
      id: orderId,
      customerId: jwtUser.sub,
      customerName: dto.patientName.trim(),
      customerPhone: normalizePhoneDigits(dto.phone),
      deliveryAddress: dto.deliveryAddress.trim(),
      notes: dto.notes?.trim(),
      status: "Pending",
      date: nowIso().slice(0, 10),
      prescriptionImageUrl,
      hasCustomerPrescription,
      requiresPharmacistReview,
      paymentStatus: "Pending",
      paymentMethod: undefined,
      paymentRef: undefined,
      deliveryJobStatus: "Unassigned",
      items: items.map((it) => ({ productId: it.productId, quantity: it.quantity })),
    };

    await ordersCol.insertOne(order);

    return {
      success: true as const,
      order: {
        id: order.id,
        status: order.status,
        date: order.date,
        prescriptionImageUrl: order.prescriptionImageUrl,
        deliveryJobStatus: order.deliveryJobStatus,
        paymentStatus: order.paymentStatus,
      },
    };
  }

  async payForOrder(jwtUser: JwtUser, orderId: string, dto: CustomerPayDto) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    await this.mongo.ensureConnected();

    const ordersCol = this.mongo.collection<OrderDoc>("orders");
    const order = await ordersCol.findOne({ id: orderId, customerId: jwtUser.sub });
    if (!order) throw new NotFoundException("Order not found");

    const paymentRef = `MOCK-${randomId("PAY")}`;

    await ordersCol.updateOne(
      { id: orderId, customerId: jwtUser.sub },
      {
        $set: {
          paymentStatus: "Paid",
          paymentMethod: dto.paymentMethod,
          paymentRef,
        },
      }
    );

    const updated = await ordersCol.findOne({ id: orderId, customerId: jwtUser.sub });
    if (!updated) throw new NotFoundException("Order not found after update");

    return {
      success: true as const,
      order: {
        id: updated.id,
        paymentStatus: updated.paymentStatus,
        paymentMethod: updated.paymentMethod,
        paymentRef: updated.paymentRef,
        status: updated.status,
        deliveryJobStatus: updated.deliveryJobStatus,
      },
    };
  }

  async listOrders(jwtUser: JwtUser) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    await this.mongo.ensureConnected();

    const ordersCol = this.mongo.collection<OrderDoc>("orders");
    const docs = await ordersCol
      .find({ customerId: jwtUser.sub })
      .sort({ date: -1 as any })
      .toArray();

    return {
      success: true as const,
      orders: docs.map((o) => ({
        id: o.id,
        status: o.status,
        date: o.date,
        paymentStatus: o.paymentStatus,
        deliveryJobStatus: o.deliveryJobStatus,
        assignedDriver: o.assignedDriver,
      })),
    };
  }

  async getOrderById(jwtUser: JwtUser, orderId: string) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    await this.mongo.ensureConnected();

    const ordersCol = this.mongo.collection<OrderDoc>("orders");
    const order = await ordersCol.findOne({ id: orderId, customerId: jwtUser.sub });
    if (!order) throw new NotFoundException("Order not found");

    return {
      success: true as const,
      order: {
        id: order.id,
        status: order.status,
        date: order.date,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentRef: order.paymentRef,
        deliveryJobStatus: order.deliveryJobStatus,
        assignedDriver: order.assignedDriver,
        deliveryAcceptedAt: order.deliveryAcceptedAt,
        prescriptionImageUrl: order.prescriptionImageUrl,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes,
        items: order.items ?? [],
      },
    };
  }
}

