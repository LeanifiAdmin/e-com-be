import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import type { Db } from "mongodb";

import {
  drivers as seedDrivers,
  medicines as seedMedicines,
  orders as seedOrders,
  userOrderHistory as seedUserOrderHistory,
  users as seedUsers,
  type Driver,
  type Medicine,
  type Order,
  type UserOrderHistory,
} from "../admin/mock-db";
import { MongoService } from "./mongo.service";

type RoleDoc = {
  username: string;
  role: "admin" | "pharmacist" | "driver" | "customer";
  name: string;
};

type UserDoc = {
  username: string;
  email?: string;
  name: string;
  passwordHash: string;
  role: "admin" | "pharmacist" | "driver" | "customer";
  phone?: string;
};

@Injectable()
export class MongoSeeder implements OnModuleInit {
  private readonly logger = new Logger(MongoSeeder.name);

  constructor(private readonly mongo: MongoService) {}

  async onModuleInit() {
    await this.mongo.ensureConnected();
    const db = this.mongo.getDb();
    await this.seedRoles(db);
    await this.seedMedicines(db);
    await this.seedUsers(db);
    await this.seedUserOrderHistory(db);
    await this.seedOrders(db);
    await this.seedDrivers(db);
  }

  private async seedRoles(db: Db) {
    const roles = db.collection<RoleDoc>("roles");

    // Keep roles limited to a fixed set required by the admin/delivery frontend.
    const allowedUsernames = ["admin", "pharmacist", "driver", "customer"] as const;

    // Migrate legacy role docs from staff -> pharmacist.
    await roles.updateMany(
      { role: "staff" } as any,
      { $set: { role: "pharmacist", name: "Pharmacist User" } }
    );
    // If legacy username was "staff", rename to "pharmacist" so it isn't deleted below.
    await roles.updateMany(
      { username: "staff" } as any,
      { $set: { username: "pharmacist", role: "pharmacist", name: "Pharmacist User" } }
    );
    await roles.deleteMany({ username: { $nin: [...allowedUsernames] } });

    const rolesToSeed: Array<Omit<RoleDoc, never>> = [
      { username: "admin", role: "admin", name: "Admin User" },
      { username: "pharmacist", role: "pharmacist", name: "Pharmacist User" },
      { username: "driver", role: "driver", name: "Driver" },
      { username: "customer", role: "customer", name: "Customer" },
    ];

    for (const r of rolesToSeed) {
      await roles.updateOne(
        { username: r.username },
        {
          $set: { username: r.username, role: r.role, name: r.name },
          $unset: { passwordHash: "" },
        },
        { upsert: true }
      );
    }
  }

  private async seedMedicines(db: Db) {
    const medicines = db.collection<Medicine>("medicines");
    const count = await medicines.countDocuments();
    if (count > 0) return;
    await medicines.insertMany(seedMedicines as Medicine[]);
  }

  private async seedUsers(db: Db) {
    const users = db.collection<UserDoc>("users");
    const passwordHash = bcrypt.hashSync("password", 10);

    // Migrate older schema: if docs have `id` but no `username`, convert them.
    const legacyDocs = await users
      .find({ username: { $exists: false }, id: { $exists: true } } as any)
      .toArray();

    for (const doc of legacyDocs as any[]) {
      await users.updateOne(
        { _id: doc._id },
        {
          $set: {
            username: doc.id,
            name: doc.name,
            phone: doc.phone,
            email: doc.email,
            role: "customer",
            passwordHash,
          },
          $unset: { id: "" },
        }
      );
    }

    // Migrate legacy users from staff -> pharmacist.
    await users.updateMany({ role: "staff" } as any, { $set: { role: "pharmacist" } });

    await users.updateMany(
      { username: "admin", email: "admin@leanifi.com" },
      { $set: { email: "admin@leanifi.io" } }
    );

    const baseUsers: UserDoc[] = [
      {
        username: "admin",
        email: "admin@leanifi.io",
        name: "Admin User",
        phone: "+91 9876541009",
        role: "admin",
        passwordHash,
      },
      {
        username: "pharmacist",
        email: "pharmacist@leanifi.com",
        name: "Pharmacist User",
        phone: "+91 9876541002",
        role: "pharmacist",
        passwordHash,
      },
      // Customer seed (from mock-db)
      ...((seedUsers as any[]).map((u) => ({
        username: u.id,
        email: u.email,
        name: u.name,
        phone: u.phone,
        role: "customer" as const,
        passwordHash,
      })) as UserDoc[]),
      // Driver seed
      ...((seedDrivers as Driver[]).map((d) => ({
        username: d.id,
        email: undefined as string | undefined,
        name: d.name,
        phone: undefined as string | undefined,
        role: "driver" as const,
        passwordHash,
      })) as UserDoc[]),
    ];

    for (const u of baseUsers) {
      await users.updateOne(
        { username: u.username },
        {
          $set: {
            username: u.username,
            email: u.email,
            name: u.name,
            phone: u.phone,
            role: u.role,
            passwordHash,
          },
        },
        { upsert: true }
      );
    }
  }

  private async seedUserOrderHistory(db: Db) {
    const records = db.collection<UserOrderHistory>("userOrderHistory");
    const count = await records.countDocuments();
    if (count > 0) return;
    await records.insertMany(seedUserOrderHistory as UserOrderHistory[]);
  }

  private async seedOrders(db: Db) {
    const orders = db.collection<any>("orders");
    const count = await orders.countDocuments();
    if (count > 0) return;

    const docs = (seedOrders as Order[]).map((o) => {
      return {
        ...o,
        deliveryJobStatus: o.assignedDriver ? "Assigned" : "Unassigned",
      };
    });

    await orders.insertMany(docs);
  }

  private async seedDrivers(db: Db) {
    const drivers = db.collection<Driver>("drivers");
    const count = await drivers.countDocuments();
    if (count > 0) return;

    // Adjust initial driver busy/available based on seeded assignments.
    const busyDriverIds = new Set(
      (seedOrders as Order[])
        .filter((o) => !!o.assignedDriver)
        .map((o) => o.assignedDriver!.driverId)
    );

    const docs = (seedDrivers as Driver[]).map((d) => {
      if (busyDriverIds.has(d.id)) {
        return { ...d, status: "Busy" as const };
      }
      return d;
    });

    await drivers.insertMany(docs);
  }
}

