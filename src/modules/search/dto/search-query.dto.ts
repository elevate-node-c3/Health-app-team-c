import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchQueryDto {
    @IsString()
    @MaxLength(500, { message: 'Search query must not exceed 500 characters.' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    q: string;

    @IsOptional()
    @IsString()
    requestId?: string;

    @IsOptional()
    @IsString()
    timestamp?: string;
}
