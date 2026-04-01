import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { MongoModule } from "../database/mongo.module";

import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { CustomerOrdersModule } from "./orders/customer-orders.module";

@Module({
  imports: [AuthModule, MongoModule, CustomerOrdersModule],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}

