import { Module } from "@nestjs/common";
import { MongoService } from "./mongo.service";
import { MongoSeeder } from "./mongo.seeder";

@Module({
  providers: [MongoService, MongoSeeder],
  exports: [MongoService],
})
export class MongoModule {}

