import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateMedicineDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(5)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty!: number;
}

export class UpdateMedicineDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

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
  @IsInt()
  @Min(0)
  stockQty?: number;
}

