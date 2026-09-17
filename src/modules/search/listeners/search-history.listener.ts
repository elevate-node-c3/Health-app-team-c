import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSearchEntity } from '../../auth/entities/user-search.entity';
import { GuestSearchEntity } from '../../auth/entities/guest-search.entity';
import { SearchPerformedEvent } from '../events/search-performed.event';

@Injectable()
export class SearchHistoryListener {
    private readonly logger = new Logger(SearchHistoryListener.name);
    private readonly MAX_HISTORY_ITEMS = 20;

    constructor(
        @InjectRepository(UserSearchEntity)
        private readonly userSearchRepo: Repository<UserSearchEntity>,
        @InjectRepository(GuestSearchEntity)
        private readonly guestSearchRepo: Repository<GuestSearchEntity>,
    ) { }

    @OnEvent('search.performed')
    async handleSearchPerformed(event: SearchPerformedEvent) {
        const query = (event.query || '').trim();
        if (!query) return;

        try {
            if (event.userId) {
                await this.saveUserSearch(event.userId, query);
            } else if (event.deviceId) {
                await this.saveGuestSearch(event.deviceId, query);
            }
        } catch (err: any) {
            this.logger.error(`Failed to save search history for query "${query}": ${err.message}`, err.stack);
        }
    }

    private async saveUserSearch(userId: string, query: string) {
        const existing = await this.userSearchRepo.findOne({
            where: { userId, searchQuery: query },
        });

        if (existing) {
            existing.updatedAt = new Date();
            await this.userSearchRepo.save(existing);
        } else {
            const newEntry = this.userSearchRepo.create({
                userId,
                searchQuery: query,
            });
            await this.userSearchRepo.save(newEntry);
        }

        // Prune older searches if exceeding limit
        const userCount = await this.userSearchRepo.count({ where: { userId } });
        if (userCount > this.MAX_HISTORY_ITEMS) {
            const oldest = await this.userSearchRepo.find({
                where: { userId },
                order: { updatedAt: 'ASC' },
                take: userCount - this.MAX_HISTORY_ITEMS,
            });
            if (oldest.length > 0) {
                await this.userSearchRepo.remove(oldest);
            }
        }
    }

    private async saveGuestSearch(deviceId: string, query: string) {
        const existing = await this.guestSearchRepo.findOne({
            where: { deviceId, searchQuery: query },
        });

        if (existing) {
            existing.updatedAt = new Date();
            await this.guestSearchRepo.save(existing);
        } else {
            const newEntry = this.guestSearchRepo.create({
                deviceId,
                searchQuery: query,
            });
            await this.guestSearchRepo.save(newEntry);
        }

        // Prune older guest searches if exceeding limit
        const guestCount = await this.guestSearchRepo.count({ where: { deviceId } });
        if (guestCount > this.MAX_HISTORY_ITEMS) {
            const oldest = await this.guestSearchRepo.find({
                where: { deviceId },
                order: { updatedAt: 'ASC' },
                take: guestCount - this.MAX_HISTORY_ITEMS,
            });
            if (oldest.length > 0) {
                await this.guestSearchRepo.remove(oldest);
            }
        }
    }
}
