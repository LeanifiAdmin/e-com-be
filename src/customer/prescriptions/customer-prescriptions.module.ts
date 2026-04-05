import { Module } from "@nestjs/common";
import { MongoModule } from "../../database/mongo.module";
import { CustomerPrescriptionsController } from "./customer-prescriptions.controller";
import { CustomerPrescriptionsService } from "./customer-prescriptions.service";

@Module({
  imports: [MongoModule],
  controllers: [CustomerPrescriptionsController],
  providers: [CustomerPrescriptionsService],
})
export class CustomerPrescriptionsModule {}
