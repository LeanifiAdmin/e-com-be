import { IsString, MinLength } from "class-validator";

export class PharmacistLoginDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}

