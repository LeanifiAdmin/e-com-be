import { IsString, MinLength } from "class-validator";

export class CustomerPhoneSendOtpDto {
  @IsString()
  @MinLength(10)
  phone!: string;
}

