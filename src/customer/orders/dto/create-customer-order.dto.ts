import { Transform, Type } from "class-transformer";
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";

export class CustomerOrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateCustomerOrderDto {
  @IsString()
  @IsNotEmpty()
  patientName!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  deliveryAddress!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // When sending multipart/form-data, complex arrays often arrive as a JSON string.
  @Transform(({ value }) => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  @IsArray()
  @Type(() => CustomerOrderItemDto)
  items!: CustomerOrderItemDto[];
}

