import { IsEmail, IsOptional, IsString, Matches, MinLength, ValidateIf } from "class-validator";

export class UpdatePharmacistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== undefined && v !== "")
  @IsString()
  @MinLength(10)
  @Matches(/^\+?\d+$/, { message: "phone must contain only digits (optional leading +)" })
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;
}
