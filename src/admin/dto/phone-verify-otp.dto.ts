import { IsString, Length } from "class-validator";

export class PhoneVerifyOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}

