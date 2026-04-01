import { IsString, Length } from "class-validator";

export class CustomerPhoneVerifyOtpDto {
  @IsString()
  phone!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}

