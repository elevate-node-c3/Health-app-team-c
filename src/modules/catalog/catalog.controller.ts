import { Controller, Get, Post, Delete, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UserStatus } from '../auth/entities/user.entity';

@Controller('catalog')
export class CatalogController {
    constructor(private readonly catalogService: CatalogService) { }

    @Get('home')

    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN, UserStatus.GUEST)
    async getHome(@Req() req) {
        const userContext = req.userContext;
        console.log('FULL REQ USER CONTEXT:', req.userContext);
        const clientIp = req.ip || req.headers['x-forwarded-for'];

        const userInfo = userContext && userContext.role !== 'GUEST' ? {
            id: userContext.userId,
            fullName: userContext.fullName,
        } : undefined;

        const data = await this.catalogService.getHomeDashboard(userInfo, clientIp);

        return {
            success: true,
            data,
        };
    }

    @Get('favorites')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    async listFavorites(@Req() req) {
        return this.catalogService.listFavorites(req.userContext!.userId!);
    }

    @Post('favorites/:doctorId')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    async addFavorite(@Param('doctorId', ParseUUIDPipe) doctorId: string, @Req() req) {
        return this.catalogService.addFavorite(req.userContext!.userId!, doctorId);
    }

    @Delete('favorites/:doctorId')
    @UseGuards(RolesGuard)
    @Roles(UserStatus.UNVERIFIED_PATIENT, UserStatus.PATIENT, UserStatus.DOCTOR, UserStatus.ADMIN)
    async removeFavorite(@Param('doctorId', ParseUUIDPipe) doctorId: string, @Req() req) {
        return this.catalogService.removeFavorite(req.userContext!.userId!, doctorId);
    }
}