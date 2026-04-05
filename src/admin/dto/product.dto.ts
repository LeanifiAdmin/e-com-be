import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from "class-validator";

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  image!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  additional_images?: string[];

  @IsString()
  @MinLength(80)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_percent?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pack_size?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @IsOptional()
  @IsBoolean()
  prescription_required?: boolean;

  @IsOptional()
  @IsBoolean()
  bestSeller?: boolean;

  /** Parent category logical `id` (e.g. cat-123456), not Mongo `_id`. */
  @IsString()
  @MinLength(1)
  category_id!: string;

  @IsString()
  @MinLength(1)
  subcategory_id!: string;

  /** Pre-allocated 8-digit id (from POST /admin/products/allocate-id). Must match S3 upload `productId`. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/, { message: "product_id must be exactly 8 digits" })
  product_id?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  image?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  additional_images?: string[];

  @IsOptional()
  @IsString()
  @MinLength(80)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_percent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  pack_size?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  brand?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @IsOptional()
  @IsBoolean()
  prescription_required?: boolean;

  @IsOptional()
  @IsBoolean()
  bestSeller?: boolean;

  /** Parent category logical `id`; API still accepts legacy Mongo `_id` and normalizes to `id`. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  category_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subcategory_id?: string;
}

