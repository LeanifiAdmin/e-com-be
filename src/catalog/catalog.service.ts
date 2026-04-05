import { Injectable, OnModuleInit, NotFoundException } from "@nestjs/common";
import { ObjectId } from "mongodb";

import { MongoService } from "../database/mongo.service";
import { CatalogProductsQueryDto } from "./dto/catalog-products-query.dto";

type CategoryDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  imageUrl?: string;
  imageUpdatedAt?: string;
  createdAt: string;
};
type SubcategoryDoc = {
  _id?: ObjectId;
  id: string;
  name: string;
  category_id: string;
  imageUrl?: string;
  imageUpdatedAt?: string;
  createdAt: string;
};

type ProductDoc = {
  _id?: ObjectId;
  id: string;
  product_id?: string;
  title?: string;
  name: string;
  image?: string;
  additional_images?: string[];
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
type Category = { _id: string; id: string; name: string; imageUrl?: string; imageUpdatedAt?: string; createdAt: string };
type Subcategory = SubcategoryDoc & { _id?: string };

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix: string) {
  return `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function productMediaUrls(doc: {
  image?: string;
  additional_images?: string[];
  images?: string[];
}): string[] {
  const primary = doc.image?.trim();
  if (primary) {
    const extras = Array.isArray(doc.additional_images)
      ? doc.additional_images.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean)
      : [];
    return [primary, ...extras];
  }
  const legacy = doc.images;
  if (Array.isArray(legacy) && legacy.length) {
    return legacy.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean);
  }
  return [];
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

      // Default subcategory references category logical `id`.
      const defaultSubcategory = await subcategoriesCol.findOne({ id: DEFAULT_SUBCATEGORY_KEY });
      if (!defaultSubcategory) {
        await subcategoriesCol.insertOne({
          id: DEFAULT_SUBCATEGORY_KEY,
          name: "Default",
          category_id: defaultCategory.id,
          createdAt: nowIso(),
        });
      } else if (defaultSubcategory.category_id !== defaultCategory.id) {
        await subcategoriesCol.updateOne(
          { id: DEFAULT_SUBCATEGORY_KEY },
          { $set: { category_id: defaultCategory.id } }
        );
      }

      const categories = await categoriesCol.find({}).toArray();
      for (const c of categories) {
        if (!c._id) continue;
        const oid = c._id.toString();
        await subcategoriesCol.updateMany({ category_id: oid }, { $set: { category_id: c.id } });
        await productsCol.updateMany({ category_id: oid }, { $set: { category_id: c.id } });
      }

      // Legacy: rename `medicines` → `products` once only (no re-copy from `medicines` when empty).
      try {
        const cols = await db.listCollections({}, { nameOnly: true }).toArray();
        const hasMedicines = cols.some((c) => c.name === "medicines");
        const hasProducts = cols.some((c) => c.name === "products");
        if (hasMedicines && !hasProducts) {
          await db.renameCollection("medicines", "products");
        }
      } catch {
        // Best effort only.
      }
    })();

    return this.ensurePromise;
  }

  /** Map query param to stored `category_id` (logical id); accepts legacy Mongo `_id` hex. */
  private async resolveCategoryIdForFilter(ref: string): Promise<string> {
    const t = ref.trim();
    if (!t) return t;
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const byLogical = await categoriesCol.findOne({ id: t });
    if (byLogical) return byLogical.id;
    if (ObjectId.isValid(t)) {
      const byOid = await categoriesCol.findOne({ _id: new ObjectId(t) });
      if (byOid) return byOid.id;
    }
    return t;
  }

  async fetchCategories(): Promise<Category[]> {
    await this.ensureCatalogDefaultsAndMigrations();
    const categoriesCol = this.mongo.collection<CategoryDoc>("categories");
    const categories = await categoriesCol.find({}).toArray();
    return categories
      .map((c) => ({
        _id: c._id?.toString() ?? "",
        id: c.id,
        name: c.name,
        imageUrl: c.imageUrl,
        imageUpdatedAt: c.imageUpdatedAt,
        createdAt: c.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async fetchSubcategories(categoryId?: string): Promise<Subcategory[]> {
    await this.ensureCatalogDefaultsAndMigrations();
    const filter = categoryId?.trim()
      ? { category_id: await this.resolveCategoryIdForFilter(categoryId) }
      : {};
    const docs = await this.mongo.collection<SubcategoryDoc>("subcategories").find(filter).toArray();
    return docs
      .map((d) => ({
        _id: d._id?.toString() ?? "",
        id: d.id,
        name: d.name,
        category_id: d.category_id,
        imageUrl: d.imageUrl,
        imageUpdatedAt: d.imageUpdatedAt,
        createdAt: d.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) as Subcategory[];
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
    if (query.categoryId) {
      filter.category_id = await this.resolveCategoryIdForFilter(query.categoryId);
    }
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
      const merged = productMediaUrls(d);
      const images = merged.length ? merged : ["/images/product-placeholder.svg"];
      const product_id = d.product_id ?? d.id;
      const title = (d.title?.trim() || d.name).trim();
      return { ...d, product_id, title, images, bestSeller: d.bestSeller ?? false } as CatalogProduct;
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
    const merged = productMediaUrls(product);
    const images = merged.length ? merged : ["/images/product-placeholder.svg"];
    const product_id = product.product_id ?? product.id;
    const title = (product.title?.trim() || product.name).trim();
    return { ...product, product_id, title, images } as CatalogProduct;
  }
}

