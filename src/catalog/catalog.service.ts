import { Injectable, OnModuleInit, NotFoundException } from "@nestjs/common";
import { ObjectId } from "mongodb";

import { MongoService } from "../database/mongo.service";
import { CatalogProductsQueryDto } from "./dto/catalog-products-query.dto";

type CategoryDoc = { _id?: ObjectId; id: string; name: string; imageUrl?: string; createdAt: string };
type SubcategoryDoc = { _id?: ObjectId; id: string; name: string; category_id: string; imageUrl?: string; createdAt: string };

type ProductDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  images?: string[];
  description: string;
  price: number;
  mrp?: number;
  discount_percent?: number;
  bestSeller?: boolean;
  stockQty: number;
  pack_size?: string;
  brand?: string;
  sku?: string;
  prescription_required?: boolean;
  category_id: string;
  subcategory_id: string;
  createdAt: string;
  updatedAt?: string;
};

type CatalogProduct = Omit<ProductDoc, "_id">;
type Category = { _id: string; id: string; name: string; createdAt: string };
type Subcategory = SubcategoryDoc & { _id?: string };

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

@Injectable()
export class CatalogService implements OnModuleInit {
  private ensurePromise: Promise<void> | null = null;

  constructor(private readonly mongo: MongoService) {}

  async onModuleInit() {
    // Best-effort catalog migrations so the storefront works even if admin hasn't been used yet.
    await this.ensureCatalogDefaultsAndMigrations();
  }

  private async ensureCatalogDefaultsAndMigrations(): Promise<void> {
    if (this.ensurePromise) return this.ensurePromise;

    this.ensurePromise = (async () => {
      await this.mongo.ensureConnected();
      const db = this.mongo.getDb();

      const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
      const subcategoriesCol = this.mongo.collection<SubcategoryDoc>("subcategories");
      const medicinesCol = this.mongo.collection<any>("medicines");
      const productsCol = this.mongo.collection<ProductDoc>("products");

      const DEFAULT_CATEGORY_KEY = "cat-default";
      const DEFAULT_SUBCATEGORY_KEY = "subcat-default";

      // Ensure default category exists.
      let defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
      if (!defaultCategory) {
        await categoriesCol.insertOne({ id: DEFAULT_CATEGORY_KEY, name: "Default", createdAt: nowIso() });
        defaultCategory = await categoriesCol.findOne({ id: DEFAULT_CATEGORY_KEY });
      }
      if (!defaultCategory?._id) return;
      const defaultCategoryObjectId = defaultCategory._id.toString();

      // Ensure default subcategory exists and points to the default category ObjectId.
      const defaultSubcategory = await subcategoriesCol.findOne({ id: DEFAULT_SUBCATEGORY_KEY });
      if (!defaultSubcategory) {
        await subcategoriesCol.insertOne({
          id: DEFAULT_SUBCATEGORY_KEY,
          name: "Default",
          category_id: defaultCategoryObjectId,
          createdAt: nowIso(),
        });
      } else if (defaultSubcategory.category_id !== defaultCategoryObjectId) {
        await subcategoriesCol.updateOne(
          { id: DEFAULT_SUBCATEGORY_KEY },
          { $set: { category_id: defaultCategoryObjectId } }
        );
      }

      // Migrate legacy subcategories where category_id stored category `id` key.
      const categories = await categoriesCol.find({}).toArray();
      for (const c of categories) {
        if (!c._id) continue;
        await subcategoriesCol.updateMany({ category_id: c.id }, { $set: { category_id: c._id.toString() } });
      }

      // Ensure products collection exists (legacy medicines rename/copy best effort).
      try {
        const cols = await db.listCollections({}, { nameOnly: true }).toArray();
        const hasMedicines = cols.some((c) => c.name === "medicines");
        const hasProducts = cols.some((c) => c.name === "products");

        if (hasMedicines && !hasProducts) {
          await db.renameCollection("medicines", "products");
        } else if (hasMedicines && hasProducts) {
          const count = await productsCol.countDocuments({});
          if (count === 0) {
            const meds = await medicinesCol.find({}).toArray();
            if (meds.length) {
              await productsCol.insertMany(
                meds.map((m) => ({
                  id: m.id ?? randomId("prod"),
                  name: String(m.name ?? "Unnamed product"),
                  images: Array.isArray(m.images) ? m.images : [],
                  description: String(m.description ?? ""),
                  price: Number(m.price ?? 0),
                  stockQty: Number(m.stockQty ?? 0),
                  category_id: m.category_id ?? defaultCategoryObjectId,
                  subcategory_id: m.subcategory_id ?? DEFAULT_SUBCATEGORY_KEY,
                  createdAt: m.createdAt ?? nowIso(),
                }))
              );
            }
          }
        }
      } catch {
        // Best effort only.
      }
    })();

    return this.ensurePromise;
  }

  async fetchCategories(): Promise<(Category & { imageUrl?: string })[]> {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const categories = await categoriesCol.find({}).toArray();
    return categories
      .map((c) => ({ _id: c._id?.toString() ?? "", id: c.id, name: c.name, imageUrl: c.imageUrl, createdAt: c.createdAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async fetchSubcategories(categoryId?: string): Promise<Subcategory[]> {
    await this.ensureCatalogDefaultsAndMigrations();
    const filter = categoryId ? { category_id: categoryId } : {};
    const docs = await this.mongo.collection<SubcategoryDoc>("subcategories").find(filter).toArray();
    return docs.sort((a, b) => a.name.localeCompare(b.name)) as Subcategory[];
  }

  async fetchProducts(query: CatalogProductsQueryDto): Promise<{ items: CatalogProduct[]; page: number; pageSize: number; hasMore: boolean }> {
    await this.ensureCatalogDefaultsAndMigrations();

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const skip = (page - 1) * pageSize;

    const productsCol = this.mongo.collection<ProductDoc>("products");
    const filter: Record<string, unknown> = {};

    if (query.search) {
      filter.name = { $regex: query.search.trim(), $options: "i" } as any;
    }
    if (query.categoryId) filter.category_id = query.categoryId;
    if (query.subcategoryId) filter.subcategory_id = query.subcategoryId;
    if (query.brand) filter.brand = query.brand.trim();
    if (query.priceMin !== undefined || query.priceMax !== undefined) {
      filter.price = {
        ...(query.priceMin !== undefined ? { $gte: query.priceMin } : {}),
        ...(query.priceMax !== undefined ? { $lte: query.priceMax } : {}),
      } as any;
    }
    if (query.prescriptionRequired !== undefined) filter.prescription_required = query.prescriptionRequired;
    if (query.bestSeller !== undefined) filter.bestSeller = query.bestSeller;

    const cursor = productsCol
      .find(filter)
      .sort({ createdAt: -1 as any })
      .skip(skip)
      .limit(pageSize);

    const docs = await cursor.toArray();
    const items = docs.map((d) => {
      // Normalize missing image list.
      const images = Array.isArray(d.images) ? d.images : ["/images/product-placeholder.svg"];
      return { ...d, images, bestSeller: d.bestSeller ?? false } as CatalogProduct;
    });

    return {
      items,
      page,
      pageSize,
      hasMore: docs.length === pageSize,
    };
  }

  async fetchProductById(id: string): Promise<CatalogProduct> {
    await this.ensureCatalogDefaultsAndMigrations();
    const productsCol = this.mongo.collection<ProductDoc>("products");
    const product = await productsCol.findOne({ id });
    if (!product) throw new NotFoundException("Product not found");
    const images = Array.isArray(product.images) ? product.images : ["/images/product-placeholder.svg"];
    return { ...product, images } as CatalogProduct;
  }
}

