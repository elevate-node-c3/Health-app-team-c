import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class UpdateSavedCardDto {
    @IsString()
    @IsOptional()
    cardHolderName?: string;

    @IsNumber()
    @Min(1)
    @Max(12)
    @IsOptional()
    expiryMonth?: number;

    @IsNumber()
    @Min(new Date().getFullYear())
    @Max(new Date().getFullYear() + 20)
    @IsOptional()
    expiryYear?: number;

    @Type(() => Boolean)
    @IsOptional()
    isDefault?: boolean;
}