import {
    Controller,
    Get,
    Delete,
    Query,
    Param,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchDoctorsDto } from './dto/search-doctors.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserStatus } from '../auth/entities/user.entity';

@Controller('search')
export class SearchController {
    constructor(private readonly searchService: SearchService) { }

    @Get()
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async search(@Query() dto: SearchQueryDto, @Req() req: Request) {
        const userContext = req.userContext;
        const clientIp = req.ip || (req.headers['x-forwarded-for'] as string);

        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
            clientIp,
        };

        return this.searchService.search(dto, identity);
    }

    @Get('doctors')
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async searchDoctors(@Query() dto: SearchDoctorsDto, @Req() req: Request) {
        const userContext = req.userContext;
        const clientIp = req.ip || (req.headers['x-forwarded-for'] as string);

        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
            clientIp,
        };

        return this.searchService.searchDoctors(dto, identity);
    }

    @Get('suggestions')
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async getSuggestions(@Query() dto: SearchQueryDto, @Req() req: Request) {
        const userContext = req.userContext;
        const clientIp = req.ip || (req.headers['x-forwarded-for'] as string);

        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
            clientIp,
        };

        return this.searchService.getSuggestions(dto, identity);
    }

    @Get('history')
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async getHistory(@Req() req: Request) {
        const userContext = req.userContext;
        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
        };

        return this.searchService.getHistory(identity);
    }

    @Delete('history')
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async clearHistory(@Req() req: Request) {
        const userContext = req.userContext;
        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
        };

        return this.searchService.clearHistory(identity);
    }

    @Delete('history/:id')
    @UseGuards(RolesGuard)
    @Roles(
        UserStatus.GUEST,
        UserStatus.UNVERIFIED_PATIENT,
        UserStatus.PATIENT,
        UserStatus.DOCTOR,
        UserStatus.ADMIN,
    )
    @HttpCode(HttpStatus.OK)
    async deleteHistoryItem(
        @Param('id', ParseUUIDPipe) id: string,
        @Req() req: Request,
    ) {
        const userContext = req.userContext;
        const identity = {
            userId: userContext && userContext.role !== 'GUEST' ? userContext.userId : undefined,
            deviceId: userContext ? userContext.deviceId : undefined,
        };

        return this.searchService.deleteHistoryItem(id, identity);
    }
}
