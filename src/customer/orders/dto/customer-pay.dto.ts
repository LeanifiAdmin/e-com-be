import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export type PaymentMethod = "bKash" | "Nagad" | "Rocket" | "Card";

export class CustomerPayDto {
  @IsIn(["bKash", "Nagad", "Rocket", "Card"])
  paymentMethod!: PaymentMethod;

  // For card payments this can carry additional metadata later.
  @IsOptional()
  @IsString()
  @MinLength(3)
  paymentToken?: string;
}

