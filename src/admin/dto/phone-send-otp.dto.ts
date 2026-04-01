import { IsMobilePhone, IsString, MinLength } from "class-validator";

export class PhoneSendOtpDto {
  @IsString()
  @MinLength(10)
  // Relaxed validator: backend will accept digits-only + optional leading +.
  phone!: string;
}

