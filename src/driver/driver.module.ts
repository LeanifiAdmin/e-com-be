import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MongoModule } from "../database/mongo.module";
import { DriverController } from "./driver.controller";
import { DriverService } from "./driver.service";

@Module({
  imports: [AuthModule, MongoModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}

