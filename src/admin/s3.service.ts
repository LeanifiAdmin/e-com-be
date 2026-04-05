import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { S3Client } from "@aws-sdk/client-s3/dist-types/S3Client";
import { randomBytes } from "crypto";

/** CJS module — `import sharp from "sharp"` emits `default` calls that fail at runtime. */
import sharp = require("sharp");

// The package root typings don't resolve `S3Client` / `import *` reliably in this Nest+TS setup.
// Load the CommonJS bundle at runtime and type the client from the official class definition.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  S3Client: S3ClientCtor,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3") as {
  S3Client: new (args: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => S3Client;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType?: string;
    CacheControl?: string;
  }) => InstanceType<typeof import("@smithy/smithy-client").Command>;
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  ListObjectsV2Command: new (input: {
    Bucket: string;
    Prefix: string;
    ContinuationToken?: string;
  }) => unknown;
  DeleteObjectsCommand: new (input: {
    Bucket: string;
    Delete: { Objects: { Key: string }[] };
  }) => unknown;
};

/** Sanitize category name into a safe S3 path segment (matches admin basename / frontend slugify). */
export function sanitizeCategoryFolderSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s || "category";
}

/** Same rules as category slug; used for subcategory folder segments. */
export function sanitizeSubcategoryFolderSlug(raw: string): string {
  return sanitizeCategoryFolderSlug(raw);
}

/**
 * Safe folder segment for a product's image prefix. Prefer stable IDs (e.g. product `id`), not display names,
 * so duplicate product titles never overwrite each other in S3.
 */
export function sanitizeProductFolderSegment(raw: string): string {
  const t = raw.trim();
  if (/^\d{8}$/.test(t)) return t;
  const s = t
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return s.length >= 6 ? s : randomBytes(10).toString("hex");
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.get<string>("AWS_REGION") ?? "ap-south-1";
    this.bucket = this.config.get<string>("AWS_CATEGORY_BUCKET_NAME") ?? "";
    const accessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY") ?? this.config.get<string>("AWS_ACCESS_KEY_ID") ?? "";
    const secretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ?? this.config.get<string>("AWS_ACCESS_KEY_ID") ?? "";

    if (this.bucket && accessKeyId && secretAccessKey) {
      this.client = new S3ClientCtor({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log(`S3 category uploads enabled (bucket: ${this.bucket}, region: ${this.region})`);
    } else {
      this.client = null;
      this.logger.warn(
        "S3 category uploads disabled: set AWS_CATEGORY_BUCKET_NAME, AWS_REGION, and IAM credentials (AWS_ACCESS_KEY or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)."
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.bucket);
  }

  /**
   * Uploads image as JPEG. With folderSlug, stores at `{slug}/{slug}.jpeg`.
   * Without folderSlug (e.g. row image replace), stores under `category-updates/…`.
   * Returns the virtual-hosted URL; anonymous read requires a bucket policy (ACLs often disabled on new buckets).
   */
  async uploadCategoryImage(buffer: Buffer, _mimetype: string, folderSlug?: string): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new Error(
        "S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials in the environment."
      );
    }

    const jpegBuffer = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();

    let key: string;
    if (folderSlug?.trim()) {
      const slug = sanitizeCategoryFolderSlug(folderSlug);
      key = `${slug}/${slug}.jpeg`;
    } else {
      key = `category-updates/${Date.now()}-${randomBytes(8).toString("hex")}.jpeg`;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpegBuffer,
        ContentType: "image/jpeg",
        CacheControl: "max-age=31536000, public",
      })
    );

    return this.publicObjectUrl(key);
  }

  /**
   * Subcategory image: `{categorySlug}/{subcategorySlug}/{subcategorySlug}.jpeg` (public URL, bucket policy for read).
   */
  async uploadSubcategoryImage(
    buffer: Buffer,
    _mimetype: string,
    categoryFolderSource: string,
    subcategoryFolderSource: string
  ): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new Error(
        "S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials in the environment."
      );
    }
    const jpegBuffer = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();
    const cat = sanitizeCategoryFolderSlug(categoryFolderSource);
    const sub = sanitizeSubcategoryFolderSlug(subcategoryFolderSource);
    const key = `${cat}/${sub}/${sub}.jpeg`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpegBuffer,
        ContentType: "image/jpeg",
        CacheControl: "max-age=31536000, public",
      })
    );

    return this.publicObjectUrl(key);
  }

  /**
   * Product images: `{categorySlug}/{subcategorySlug}/{8-digit-id}/primary.jpeg`, then `1.jpeg`…`5.jpeg` for extras.
   * `productIdForPath` is the 8-digit `product_id` stored in the DB (same as document `id`).
   */
  async uploadProductImages(
    files: Array<{ buffer: Buffer; mimetype: string }>,
    categoryFolderSource: string,
    subcategoryFolderSource: string,
    productIdForPath: string
  ): Promise<string[]> {
    if (!this.client || !this.bucket) {
      throw new Error(
        "S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials in the environment."
      );
    }
    const cat = sanitizeCategoryFolderSlug(categoryFolderSource);
    const sub = sanitizeSubcategoryFolderSlug(subcategoryFolderSource);
    const productFolder = sanitizeProductFolderSegment(productIdForPath);
    const urls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.buffer?.length) continue;
      const jpegBuffer = await sharp(file.buffer).rotate().jpeg({ quality: 88 }).toBuffer();
      const fileName = i === 0 ? "primary.jpeg" : `${i}.jpeg`;
      const key = `${cat}/${sub}/${productFolder}/${fileName}`;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: jpegBuffer,
          ContentType: "image/jpeg",
          CacheControl: "max-age=31536000, public",
        })
      );

      urls.push(this.publicObjectUrl(key));
    }

    if (!urls.length) {
      throw new Error("No image data to upload");
    }
    return urls;
  }

  /**
   * Upload or replace a single product image at `slotIndex`: 0 → `primary.jpeg`, 1–5 → `{n}.jpeg`.
   */
  async uploadProductImageAtSlot(
    buffer: Buffer,
    _mimetype: string,
    categoryFolderSource: string,
    subcategoryFolderSource: string,
    productIdForPath: string,
    slotIndex: number
  ): Promise<string> {
    if (!this.client || !this.bucket) {
      throw new Error(
        "S3 is not configured. Set AWS_CATEGORY_BUCKET_NAME and AWS credentials in the environment."
      );
    }
    if (slotIndex < 0 || slotIndex > 5) {
      throw new Error("slotIndex must be between 0 and 5");
    }
    if (!buffer?.length) throw new Error("No image data to upload");
    const cat = sanitizeCategoryFolderSlug(categoryFolderSource);
    const sub = sanitizeSubcategoryFolderSlug(subcategoryFolderSource);
    const productFolder = sanitizeProductFolderSegment(productIdForPath);
    const fileName = slotIndex === 0 ? "primary.jpeg" : `${slotIndex}.jpeg`;
    const key = `${cat}/${sub}/${productFolder}/${fileName}`;
    const jpegBuffer = await sharp(buffer).rotate().jpeg({ quality: 88 }).toBuffer();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: jpegBuffer,
        ContentType: "image/jpeg",
        CacheControl: "max-age=31536000, public",
      })
    );
    return this.publicObjectUrl(key);
  }

  /** S3 path prefix without trailing slash: `{category}/{subcategory}/{productFolder}`. */
  productImageFolderPrefix(
    categoryFolderSource: string,
    subcategoryFolderSource: string,
    productIdForPath: string
  ): string {
    const cat = sanitizeCategoryFolderSlug(categoryFolderSource);
    const sub = sanitizeSubcategoryFolderSlug(subcategoryFolderSource);
    const productFolder = sanitizeProductFolderSegment(productIdForPath);
    return `${cat}/${sub}/${productFolder}`;
  }

  /**
   * Remove numbered extras `N.jpeg`…`5.jpeg` that are no longer used (slot 0 is always `primary.jpeg`).
   * @param keptImageCount total images kept (1–6); deletes `keptImageCount.jpeg` through `5.jpeg` inclusive.
   */
  async deleteUnusedProductImageSlots(
    categoryFolderSource: string,
    subcategoryFolderSource: string,
    productIdForPath: string,
    keptImageCount: number
  ): Promise<void> {
    if (!this.client || !this.bucket) return;
    if (keptImageCount < 1 || keptImageCount > 6) return;
    const base = this.productImageFolderPrefix(categoryFolderSource, subcategoryFolderSource, productIdForPath);
    const keys: string[] = [];
    for (let slot = keptImageCount; slot <= 5; slot++) {
      keys.push(`${base}/${slot}.jpeg`);
    }
    if (!keys.length) return;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }) as any
      );
    } catch (e) {
      this.logger.warn(`deleteUnusedProductImageSlots failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private publicObjectUrl(key: string): string {
    const path = key.split("/").map(encodeURIComponent).join("/");
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${path}`;
  }

  /** Object key for a URL hosted on this bucket, or null. */
  parseKeyFromPublicUrl(url: string): string | null {
    if (!url || !this.bucket) return null;
    const host = `${this.bucket}.s3.${this.region}.amazonaws.com`;
    if (!url.includes(host)) return null;
    try {
      const u = new URL(url);
      return decodeURIComponent(u.pathname.replace(/^\//, ""));
    } catch {
      return null;
    }
  }

  async deleteObjectByUrl(url: string | undefined): Promise<void> {
    if (!this.client || !this.bucket || !url?.trim()) return;
    const key = this.parseKeyFromPublicUrl(url.trim());
    if (!key) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }) as any);
    } catch (e) {
      this.logger.warn(`S3 deleteObject failed for key ${key}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Delete every object whose key starts with `prefix/` (folder). */
  async deleteAllObjectsUnderPrefix(prefix: string): Promise<void> {
    if (!this.client || !this.bucket) return;
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    let continuationToken: string | undefined;
    try {
      do {
        const list: {
          Contents?: { Key?: string }[];
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        } = (await this.client.send(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: p,
            ContinuationToken: continuationToken,
          }) as any
        )) as typeof list;
        const keys = (list.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
        if (keys.length) {
          for (let i = 0; i < keys.length; i += 1000) {
            const batch = keys.slice(i, i + 1000);
            await this.client.send(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })) },
              }) as any
            );
          }
        }
        continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (e) {
      this.logger.warn(`S3 deleteAllObjectsUnderPrefix failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
