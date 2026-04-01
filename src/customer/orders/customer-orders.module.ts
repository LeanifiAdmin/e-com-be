import { Module } from "@nestjs/common";

import { MongoModule } from "../../database/mongo.module";
import { CustomerOrdersController } from "./customer-orders.controller";
import { CustomerOrdersService } from "./customer-orders.service";

@Module({
  imports: [MongoModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
})
export class CustomerOrdersModule {}

