import { Injectable, OnModuleInit, NotFoundException } from "@nestjs/common";
import type { Collection } from "mongodb";
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

      // Optional local-only demo seed (use the S3 seeder script for production-like data).
      if (process.env.SEED_DEMO_CATALOG_LOCAL === "true") {
        await this.seedDemoCatalogIfEmpty(categoriesCol, subcategoriesCol, productsCol);
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

  /**
   * When the catalog has no products yet (fresh DB), insert demo categories, subcategories, and
   * products so the storefront and admin UIs show realistic data. Uses local `/images/...` paths
   * resolved by the customer frontend.
   */
  private async seedDemoCatalogIfEmpty(
    categoriesCol: Collection<CategoryDoc>,
    subcategoriesCol: Collection<SubcategoryDoc>,
    productsCol: Collection<ProductDoc>
  ): Promise<void> {
    if ((await productsCol.countDocuments({})) > 0) return;

    const ts = nowIso();
    const placeholderCat = "/images/category-placeholder.svg";

    const demoCategories: CategoryDoc[] = [
      {
        id: "cat-wellness",
        name: "Wellness & Vitamins",
        imageUrl: placeholderCat,
        imageUpdatedAt: ts,
        createdAt: ts,
      },
      {
        id: "cat-pain",
        name: "Pain & Fever",
        imageUrl: placeholderCat,
        imageUpdatedAt: ts,
        createdAt: ts,
      },
      {
        id: "cat-digestive",
        name: "Digestive Care",
        imageUrl: placeholderCat,
        imageUpdatedAt: ts,
        createdAt: ts,
      },
    ];

    for (const c of demoCategories) {
      if (!(await categoriesCol.findOne({ id: c.id }))) {
        await categoriesCol.insertOne(c);
      }
    }

    const demoSubcategories: SubcategoryDoc[] = [
      {
        id: "sub-well-multi",
        name: "Multivitamins",
        category_id: "cat-wellness",
        imageUrl: placeholderCat,
        imageUpdatedAt: ts,
        createdAt: ts,
      },
      {
        id: "sub-well-immune",
        name: "Immunity",
        category_id: "cat-wellness",
        imageUrl: placeholderCat,
        imageUpdatedAt: ts,
        createdAt: ts,
      },
      {
        id: "sub-pain-analgesic",
        name: "Analgesics",
        category_id: "cat-pain",
        createdAt: ts,
      },
      {
        id: "sub-pain-fever",
        name: "Fever relief",
        category_id: "cat-pain",
        createdAt: ts,
      },
      {
        id: "sub-dig-antacid",
        name: "Antacids",
        category_id: "cat-digestive",
        createdAt: ts,
      },
      {
        id: "sub-dig-probiotic",
        name: "Probiotics",
        category_id: "cat-digestive",
        createdAt: ts,
      },
      {
        id: "sub-dig-hydration",
        name: "Electrolytes & hydration",
        category_id: "cat-digestive",
        createdAt: ts,
      },
    ];

    for (const s of demoSubcategories) {
      if (!(await subcategoriesCol.findOne({ id: s.id }))) {
        await subcategoriesCol.insertOne(s);
      }
    }

    const demoProducts: ProductDoc[] = [
      {
        id: "prod-demo-001",
        name: "Daily Multivitamin Tablets",
        title: "Daily Multivitamin Tablets",
        description: "Balanced vitamins and minerals for everyday wellness.",
        price: 299,
        mrp: 350,
        discount_percent: 15,
        stockQty: 120,
        pack_size: "30 tablets",
        brand: "WellLife",
        sku: "DEMO-WL-MV-30",
        prescription_required: false,
        bestSeller: true,
        category_id: "cat-wellness",
        subcategory_id: "sub-well-multi",
        image: "/images/demo-product-1.svg",
        additional_images: ["/images/demo-product-4.svg", "/images/product-placeholder.svg"],
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-002",
        name: "Vitamin C 1000mg",
        title: "Vitamin C 1000mg",
        description: "High-dose ascorbic acid to support immune health.",
        price: 420,
        mrp: 480,
        stockQty: 85,
        pack_size: "60 tablets",
        brand: "ImmunoPlus",
        sku: "DEMO-VC-1000-60",
        prescription_required: false,
        category_id: "cat-wellness",
        subcategory_id: "sub-well-immune",
        image: "/images/demo-product-1.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-003",
        name: "Zinc + Vitamin D3",
        title: "Zinc + Vitamin D3",
        description: "Combined zinc bisglycinate with cholecalciferol.",
        price: 365,
        mrp: 410,
        stockQty: 64,
        pack_size: "45 tablets",
        brand: "SunShield",
        sku: "DEMO-ZN-D3-45",
        prescription_required: false,
        category_id: "cat-wellness",
        subcategory_id: "sub-well-immune",
        image: "/images/demo-product-4.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-004",
        name: "Paracetamol 500mg",
        title: "Paracetamol 500mg",
        description: "Relieves mild to moderate pain and reduces fever.",
        price: 45,
        mrp: 60,
        stockQty: 400,
        pack_size: "20 tablets",
        brand: "ReliefMed",
        sku: "DEMO-PARA-500-20",
        prescription_required: false,
        category_id: "cat-pain",
        subcategory_id: "sub-pain-analgesic",
        image: "/images/demo-product-2.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-005",
        name: "Ibuprofen 400mg",
        title: "Ibuprofen 400mg",
        description: "NSAID for inflammatory pain — pharmacist review may apply.",
        price: 120,
        mrp: 145,
        stockQty: 90,
        pack_size: "10 tablets",
        brand: "ReliefMed",
        sku: "DEMO-IBU-400-10",
        prescription_required: true,
        category_id: "cat-pain",
        subcategory_id: "sub-pain-analgesic",
        image: "/images/demo-product-2.svg",
        additional_images: ["/images/product-placeholder.svg"],
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-006",
        name: "Paracetamol Oral Suspension",
        title: "Paracetamol Oral Suspension",
        description: "Pleasant-flavour liquid for children and adults who cannot swallow tablets.",
        price: 95,
        mrp: 110,
        stockQty: 55,
        pack_size: "100 ml",
        brand: "ReliefMed",
        sku: "DEMO-PARA-SUS-100",
        prescription_required: false,
        category_id: "cat-pain",
        subcategory_id: "sub-pain-fever",
        image: "/images/demo-product-2.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-007",
        name: "Antacid Chewable Tablets",
        title: "Antacid Chewable Tablets",
        description: "Fast relief from acidity and heartburn.",
        price: 180,
        mrp: 220,
        stockQty: 72,
        pack_size: "24 tablets",
        brand: "GutEase",
        sku: "DEMO-ANTA-CHW-24",
        prescription_required: false,
        category_id: "cat-digestive",
        subcategory_id: "sub-dig-antacid",
        image: "/images/demo-product-3.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-008",
        name: "Probiotic Capsules 10B CFU",
        title: "Probiotic Capsules 10B CFU",
        description: "Multi-strain probiotics for digestive balance.",
        price: 890,
        mrp: 999,
        discount_percent: 10,
        stockQty: 40,
        pack_size: "30 capsules",
        brand: "GutEase",
        sku: "DEMO-PROB-10B-30",
        prescription_required: false,
        bestSeller: true,
        category_id: "cat-digestive",
        subcategory_id: "sub-dig-probiotic",
        image: "/images/demo-product-3.svg",
        additional_images: ["/images/demo-product-4.svg"],
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-009",
        name: "Omega-3 Fish Oil 1000mg",
        title: "Omega-3 Fish Oil 1000mg",
        description: "EPA and DHA from purified fish oil.",
        price: 1250,
        mrp: 1390,
        stockQty: 33,
        pack_size: "60 softgels",
        brand: "WellLife",
        sku: "DEMO-O3-1K-60",
        prescription_required: false,
        category_id: "cat-wellness",
        subcategory_id: "sub-well-multi",
        image: "/images/demo-product-1.svg",
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "prod-demo-010",
        name: "ORS Sachets (Oral Rehydration)",
        title: "ORS Sachets (Oral Rehydration)",
        description: "WHO-formulated electrolyte mix for dehydration.",
        price: 140,
        mrp: 160,
        stockQty: 150,
        pack_size: "8 sachets",
        brand: "Hydrate",
        sku: "DEMO-ORS-8",
        prescription_required: false,
        category_id: "cat-digestive",
        subcategory_id: "sub-dig-hydration",
        image: "/images/demo-product-4.svg",
        createdAt: ts,
        updatedAt: ts,
      },
    ];

    for (const p of demoProducts) {
      if (!(await productsCol.findOne({ id: p.id }))) {
        await productsCol.insertOne(p);
      }
    }
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

