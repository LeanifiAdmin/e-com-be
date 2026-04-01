import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  images!: string[];

  @IsString()
  @MinLength(5)
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

  // Must be parent category Mongo _id (string)
  @IsString()
  @MinLength(1)
  category_id!: string;

  @IsString()
  @MinLength(1)
  subcategory_id!: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  @MinLength(5)
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

  @IsOptional()
  @IsString()
  @MinLength(1)
  category_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subcategory_id?: string;
}

