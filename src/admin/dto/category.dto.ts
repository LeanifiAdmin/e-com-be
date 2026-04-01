import { IsOptional, IsString, MinLength } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  imageUrl?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  imageUrl?: string;
}

