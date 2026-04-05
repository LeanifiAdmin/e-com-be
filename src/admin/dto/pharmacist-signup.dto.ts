import { IsEmail, IsString, Matches, MinLength } from "class-validator";

export class PharmacistSignupDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(4)
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  @Matches(/^\+?\d+$/, "phone must contain only digits (optional leading +)")
  phone!: string;
}

