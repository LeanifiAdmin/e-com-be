import { IsString } from "class-validator";

export class AssignDeliveryDto {
  @IsString()
  orderId!: string;

  @IsString()
  driverId!: string;
}

