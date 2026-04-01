import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

