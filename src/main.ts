import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import * as express from "express";
import cookieParser = require("cookie-parser");
import { join } from "path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "Accept", "X-Requested-With", "Cookie"],
    exposedHeaders: ["Set-Cookie"],
  });

  app.use("/uploads", express.static(join(process.cwd(), "uploads")));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 9001;
  await app.listen(port);
}
bootstrap();
