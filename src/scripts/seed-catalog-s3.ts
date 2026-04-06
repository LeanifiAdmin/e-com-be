import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module";
import { AdminService } from "../admin/admin.service";

function readArg(name: string): string | undefined {
  const idx = process.argv.findIndex((x) => x === name || x.startsWith(`${name}=`));
  if (idx === -1) return undefined;
  const tok = process.argv[idx];
  if (tok.includes("=")) return tok.split("=").slice(1).join("=");
  return process.argv[idx + 1];
}

async function main() {
  const reset = process.argv.includes("--reset");
  const categories = Number(readArg("--categories"));
  const subcategoriesPerCategory = Number(readArg("--subs-per-cat"));
  const productsPerSubcategory = Number(readArg("--products-per-sub"));
  const totalProducts = Number(readArg("--total-products"));
  const imagesPerProduct = Number(readArg("--images-per-product"));
  const includeRxRaw = readArg("--include-rx");
  const includeRx = includeRxRaw == null ? undefined : includeRxRaw === "true" || includeRxRaw === "1";

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  try {
    const admin = app.get(AdminService);
    const res = await admin.seedSyntheticCatalogToS3({
      reset,
      categories: Number.isFinite(categories) ? categories : undefined,
      subcategoriesPerCategory: Number.isFinite(subcategoriesPerCategory) ? subcategoriesPerCategory : undefined,
      productsPerSubcategory: Number.isFinite(productsPerSubcategory) ? productsPerSubcategory : undefined,
      totalProducts: Number.isFinite(totalProducts) ? totalProducts : undefined,
      imagesPerProduct: Number.isFinite(imagesPerProduct) ? imagesPerProduct : undefined,
      includeRx,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

