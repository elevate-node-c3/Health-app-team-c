import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DoctorEntity } from '../entities/doctor.entity';
import { FavoriteEntity } from '../entities/favorite.entity';
import { OutboxEventEntity } from '../../../common/outbox/entities/outbox-event.entity';
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

@Injectable()
export class AddFavoriteUseCase {
    private readonly logger = new Logger(AddFavoriteUseCase.name);

    constructor(
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        private readonly dataSource: DataSource,
        private readonly outboxProcessor: OutboxProcessorService,
    ) { }

    async execute(userId: string, doctorId: string) {
        const doctor = await this.doctorRepo.findOne({ where: { id: doctorId } });
        if (!doctor) {
            throw new NotFoundException('Doctor not found');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let eventId: string | undefined;
        let isNew = true;

        try {
            const existing = await queryRunner.manager.findOne(FavoriteEntity, {
                where: { userId, doctorId },
            });

            if (!existing) {
                try {
                    await queryRunner.manager.save(
                        FavoriteEntity,
                        queryRunner.manager.create(FavoriteEntity, { userId, doctorId }),
                    );
                } catch (err: any) {
                    if (err?.code === '23505') {
                        isNew = false;
                    } else {
                        throw err;
                    }
                }
            } else {
                isNew = false;
            }

            if (isNew) {
                const event = queryRunner.manager.create(OutboxEventEntity, {
                    aggregateType: 'FAVORITE',
                    eventType: 'doctor.favorited',
                    payload: { userId, doctorId, doctorName: doctor.fullName },
                    isProcessed: false,
                });
                eventId = (await queryRunner.manager.save(event)).id;
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }

        if (eventId) {
            setImmediate(() => {
                this.outboxProcessor.triggerPublish(eventId!).catch((err) => {
                    this.logger.error(`Instant outbox publish failed for event ID ${eventId}: ${err.message}`);
                });
            });
        }

        return {
            message: isNew ? 'Doctor added to favorites' : 'Doctor already in favorites',
            data: { doctorId, isFavorite: true },
        };
    }
}
