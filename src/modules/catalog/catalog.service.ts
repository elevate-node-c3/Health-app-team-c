import { Injectable } from '@nestjs/common';
import { GetHomeDashboardUseCase } from './use-case/get-home-dashboard.use-case';
import { AddFavoriteUseCase } from './use-case/add-favorite.use-case';
import { RemoveFavoriteUseCase } from './use-case/remove-favorite.use-case';
import { ListFavoritesUseCase } from './use-case/list-favorites.use-case';

@Injectable()
export class CatalogService {
    constructor(
        private readonly getHomeDashboardUseCase: GetHomeDashboardUseCase,
        private readonly addFavoriteUseCase: AddFavoriteUseCase,
        private readonly removeFavoriteUseCase: RemoveFavoriteUseCase,
        private readonly listFavoritesUseCase: ListFavoritesUseCase,
    ) { }

    async getHomeDashboard(user?: { id: string; fullName: string }, clientIp?: string) {
        return this.getHomeDashboardUseCase.execute(user, clientIp);
    }

    async addFavorite(userId: string, doctorId: string) {
        return this.addFavoriteUseCase.execute(userId, doctorId);
    }

    async removeFavorite(userId: string, doctorId: string) {
        return this.removeFavoriteUseCase.execute(userId, doctorId);
    }

    async listFavorites(userId: string) {
        return this.listFavoritesUseCase.execute(userId);
    }
}