import { IsEnum, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { BillingInterval } from '@agency-os/database';

export class SubscribeDto {
  @IsNotEmpty()
  planCode!: string;

  @IsEnum(BillingInterval)
  @IsOptional()
  interval?: BillingInterval = BillingInterval.MONTHLY;
}

export class CancelSubscriptionDto {
  @IsBoolean()
  @IsOptional()
  cancelAtPeriodEnd?: boolean = true;
}
