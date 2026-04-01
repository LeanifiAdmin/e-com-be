import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { Request } from "express";

import { MongoService } from "../database/mongo.service";
import type { Order } from "../admin/mock-db";
import type { JwtUser } from "../auth/jwt.strategy";

import type { DriverLoginDto } from "./dto/driver-login.dto";

type DriverJwtPayload = { sub: string; role: "driver"; name: string };

type UserDoc = {
  username: string;
  passwordHash: string;
  role: "admin" | "staff" | "driver" | "customer";
  name: string;
};

@Injectable()
export class DriverService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mongo: MongoService
  ) {}

  private issueToken(user: { id: string; name: string; role: "driver" }) {
    const payload: DriverJwtPayload = { sub: user.id, role: user.role, name: user.name };
    return this.jwtService.sign(payload);
  }

  async login(dto: DriverLoginDto) {
    await this.mongo.ensureConnected();
    const usersCol = this.mongo.collection<UserDoc>("users");
    const userDoc = await usersCol.findOne({ username: dto.driverId, role: "driver" });
    if (!userDoc) throw new NotFoundException("Driver not found");

    const ok = await bcrypt.compare(dto.password, userDoc.passwordHash);
    if (!ok) throw new BadRequestException("Invalid credentials");

    const token = this.issueToken({ id: userDoc.username, name: userDoc.name, role: "driver" });
    return { success: true as const, token, driver: { id: userDoc.username, name: userDoc.name, role: "driver" } };
  }

  async fetchAssignedJobs(jwtUser: JwtUser) {
    await this.mongo.ensureConnected();
    const orders = this.mongo.collection<any>("orders");

    const docs = await orders
      .find({
        "assignedDriver.driverId": jwtUser.sub,
        deliveryJobStatus: "Assigned",
      })
      .toArray();

    docs.sort((a: any, b: any) => (new Date(b.date).getTime() - new Date(a.date).getTime()));
    return docs as Order[];
  }

  async acceptJob(orderId: string, jwtUser: JwtUser) {
    await this.mongo.ensureConnected();

    const orders = this.mongo.collection<any>("orders");
    const drivers = this.mongo.collection<any>("drivers");

    const order = await orders.findOne({
      id: orderId,
      "assignedDriver.driverId": jwtUser.sub,
      deliveryJobStatus: "Assigned",
    });
    if (!order) throw new NotFoundException("Job not found");

    const updated = await orders.findOneAndUpdate(
      {
        id: orderId,
        "assignedDriver.driverId": jwtUser.sub,
        deliveryJobStatus: "Assigned",
      },
      {
        $set: {
          deliveryJobStatus: "Accepted",
          deliveryAcceptedAt: new Date().toISOString(),
        },
      },
      { returnDocument: "after" }
    );

    const driver = await drivers.findOne({ id: jwtUser.sub });
    if (driver && driver.status !== "Busy") {
      await drivers.updateOne({ id: jwtUser.sub }, { $set: { status: "Busy" } });
    }

    if (!updated.value) throw new NotFoundException("Job not found");
    return updated.value as Order;
  }
}

