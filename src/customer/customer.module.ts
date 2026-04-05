import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { MongoModule } from "../database/mongo.module";

import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { CustomerOrdersModule } from "./orders/customer-orders.module";
import { CustomerPrescriptionsModule } from "./prescriptions/customer-prescriptions.module";

@Module({
  imports: [AuthModule, MongoModule, CustomerOrdersModule, CustomerPrescriptionsModule],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}

