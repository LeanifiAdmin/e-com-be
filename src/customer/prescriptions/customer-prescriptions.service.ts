import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";

import { MongoService } from "../../database/mongo.service";
import type { JwtUser } from "../../auth/jwt.strategy";

export type PrescriptionRequestDoc = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress: string;
  notes?: string;
  prescriptionImageUrl: string;
  status: "Pending" | "Approved" | "Rejected";
  date: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

type PrescriptionUpload = { filename: string; originalname: string; mimetype: string };

function normalizePhoneDigits(phone: string) {
  return phone.trim().replace(/[^\d]/g, "");
}

@Injectable()
export class CustomerPrescriptionsService {
  constructor(private readonly mongo: MongoService) {}

  /** Prescription-only flow: upload PDF/image + delivery details — no cart line items. */
  async submitStandalone(jwtUser: JwtUser, body: { patientName: string; phone: string; deliveryAddress: string; notes?: string }, file?: PrescriptionUpload) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    if (!file) throw new BadRequestException("Prescription file is required");
    await this.mongo.ensureConnected();

    const col = this.mongo.collection<PrescriptionRequestDoc>("prescriptionRequests");
    const id = `PR-${Math.floor(1000 + Math.random() * 9000)}`;
    const doc: PrescriptionRequestDoc = {
      id,
      customerId: jwtUser.sub,
      customerName: body.patientName.trim(),
      customerPhone: normalizePhoneDigits(body.phone),
      deliveryAddress: body.deliveryAddress.trim(),
      notes: body.notes?.trim(),
      prescriptionImageUrl: `/uploads/prescriptions/${file.filename}`,
      status: "Pending",
      date: nowIso().slice(0, 10),
      createdAt: nowIso(),
    };
    await col.insertOne(doc);
    return {
      success: true as const,
      prescriptionRequest: {
        id: doc.id,
        status: doc.status,
        date: doc.date,
        prescriptionImageUrl: doc.prescriptionImageUrl,
      },
    };
  }

  async listMine(jwtUser: JwtUser) {
    if (jwtUser.role !== "customer") throw new UnauthorizedException("Invalid role");
    await this.mongo.ensureConnected();
    const col = this.mongo.collection<PrescriptionRequestDoc>("prescriptionRequests");
    const docs = await col.find({ customerId: jwtUser.sub }).sort({ createdAt: -1 as any }).toArray();
    return {
      success: true as const,
      items: docs.map((d) => ({
        id: d.id,
        status: d.status,
        date: d.date,
        prescriptionImageUrl: d.prescriptionImageUrl,
      })),
    };
  }
}
