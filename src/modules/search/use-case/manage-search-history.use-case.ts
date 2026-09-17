import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSearchEntity } from '../../auth/entities/user-search.entity';
import { GuestSearchEntity } from '../../auth/entities/guest-search.entity';
import { SearchIdentity } from './search-doctors-and-specialties.use-case';

@Injectable()
export class ManageSearchHistoryUseCase {
    constructor(
        @InjectRepository(UserSearchEntity)
        private readonly userSearchRepo: Repository<UserSearchEntity>,
        @InjectRepository(GuestSearchEntity)
        private readonly guestSearchRepo: Repository<GuestSearchEntity>,
    ) { }

    async getHistory(identity: SearchIdentity) {
        if (identity.userId) {
            const records = await this.userSearchRepo.find({
                where: { userId: identity.userId },
                order: { updatedAt: 'DESC' },
                take: 10,
            });
            return {
                success: true,
                data: records.map((r) => ({
                    id: r.id,
                    query: r.searchQuery,
                    updatedAt: r.updatedAt,
                })),
            };
        } else if (identity.deviceId) {
            const records = await this.guestSearchRepo.find({
                where: { deviceId: identity.deviceId },
                order: { updatedAt: 'DESC' },
                take: 10,
            });
            return {
                success: true,
                data: records.map((r) => ({
                    id: r.id,
                    query: r.searchQuery,
                    updatedAt: r.updatedAt,
                })),
            };
        }

        return { success: true, data: [] };
    }

    async clearHistory(identity: SearchIdentity) {
        if (identity.userId) {
            await this.userSearchRepo.delete({ userId: identity.userId });
        } else if (identity.deviceId) {
            await this.guestSearchRepo.delete({ deviceId: identity.deviceId });
        }
        return { success: true, message: 'Search history cleared successfully.' };
    }

    async deleteHistoryItem(id: string, identity: SearchIdentity) {
        if (identity.userId) {
            await this.userSearchRepo.delete({ id, userId: identity.userId });
        } else if (identity.deviceId) {
            await this.guestSearchRepo.delete({ id, deviceId: identity.deviceId });
        }
        return { success: true, message: 'Search history item deleted.' };
    }
}
