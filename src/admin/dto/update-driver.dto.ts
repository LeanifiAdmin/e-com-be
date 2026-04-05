import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;

  @IsOptional()
  @IsString()
  @IsIn(["Available", "Busy"])
  status?: "Available" | "Busy";
}
