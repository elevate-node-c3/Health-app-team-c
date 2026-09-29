import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ProcessPaymentDto {
    @IsString()
    @IsNotEmpty()
    holdId: string;

    @IsString()
    @IsOptional()
    paymentMethodToken?: string;

    @IsString()
    @IsOptional()
    cardId?: string;
}