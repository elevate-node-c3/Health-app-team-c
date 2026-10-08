import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type BookingTab = 'ALL' | 'UPCOMING' | 'COMPLETED' | 'CANCELLED';

export class GetMyBookingsDto {
    @IsOptional()
    @IsString()
    @IsIn(['ALL', 'UPCOMING', 'COMPLETED', 'CANCELLED'])
    tab?: BookingTab = 'ALL';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number = 10;
}
