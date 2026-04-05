import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateDriverDto {
  /** Login id (stored as `users.username` and `drivers.id`). */
  @IsString()
  @MinLength(2)
  id!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(4)
  password!: string;

  @IsOptional()
  @IsString()
  @IsIn(["Available", "Busy"])
  status?: "Available" | "Busy";
}
