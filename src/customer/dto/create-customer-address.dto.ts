import { IsString, MinLength } from "class-validator";

export class CreateCustomerAddressDto {
  @IsString()
  @MinLength(8)
  deliveryAddress!: string;
}

