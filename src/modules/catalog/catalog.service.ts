import { Injectable } from '@nestjs/common';
import { GetHomeDashboardUseCase } from './use-case/get-home-dashboard.use-case';

@Injectable()
export class CatalogService {
    constructor(
        private readonly getHomeDashboardUseCase: GetHomeDashboardUseCase,
    ) { }

    async getHomeDashboard(user?: { id: string; fullName: string }, clientIp?: string) {
        return this.getHomeDashboardUseCase.execute(user, clientIp);
    }
}