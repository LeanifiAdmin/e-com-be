import { IsString, MinLength } from "class-validator";

export class DriverLoginDto {
  @IsString()
  @MinLength(1)
  driverId!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}

