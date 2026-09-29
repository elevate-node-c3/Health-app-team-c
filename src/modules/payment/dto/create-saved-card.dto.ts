import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsNumber,
    Min,
    Max,
    IsBoolean,
    IsOptional,
    Length,
    Matches,
    max,
} from 'class-validator';
import { CardBrand } from '../entities/saved-card.entity';

export class CreateSavedCardDto {
    @IsString()
    @IsNotEmpty()
    cardHolderName: string;

    @IsEnum(CardBrand)
    cardBrand: CardBrand;

    @IsString()
    @Length(4, 4)
    @Matches(/^[0-9]{4}$/, { message: 'last4Digits must be 4 numbers' })
    last4Digits: string;

    @IsNumber()
    @Min(1)
    @Max(12)
    expiryMonth: number;

    @IsNumber()
    @Min(2026)
    @Max(2100)
    expiryYear: number;

    @IsString()
    @IsNotEmpty()
    providerCardToken: string;

    @IsString()
    @IsOptional()
    providerName?: string;

    @IsBoolean()
    @IsOptional()
    saveCard?: boolean = false;
}