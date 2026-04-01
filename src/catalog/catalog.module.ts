import { Module } from "@nestjs/common";
import { MongoModule } from "../database/mongo.module";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  imports: [MongoModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}

