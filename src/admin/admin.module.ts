import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { S3Service } from "./s3.service";
import { AuthModule } from "../auth/auth.module";
import { MongoModule } from "../database/mongo.module";

@Module({
  imports: [
    AuthModule,
    MongoModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, S3Service],
})
export class AdminModule {}

