import { Type, Transform } from "class-transformer";
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CatalogProductsQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subcategoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return value;
  })
  @IsBoolean()
  prescriptionRequired?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return value;
  })
  @IsBoolean()
  bestSeller?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

