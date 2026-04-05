import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateSubcategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  /** Parent category logical `id` (e.g. cat-123456), not Mongo `_id`. */
  @IsString()
  @MinLength(1)
  category_id!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  imageUrl?: string;
}

export class UpdateSubcategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  imageUrl?: string;
}

