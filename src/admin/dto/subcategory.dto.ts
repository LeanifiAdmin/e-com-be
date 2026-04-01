import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateSubcategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  // Must be parent category Mongo _id (string)
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

