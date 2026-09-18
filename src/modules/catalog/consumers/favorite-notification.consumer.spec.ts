import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FavoriteNotificationConsumer } from './favorite-notification.consumer';
import { DoctorEntity } from '../entities/doctor.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { ProcessedEventEntity } from '../../../common/outbox/entities/processed-event.entity';

describe('FavoriteNotificationConsumer (CAT-7)', () => {
    let consumer: FavoriteNotificationConsumer;
    let notificationRepo: any;
    let processedRepo: any;
    let doctorRepo: any;

    const msg = { userId: 'user-1', doctorId: 'doc-1', doctorName: 'Omar Ahmed' };
    const amqpMsg: any = { properties: { headers: { 'x-event-id': 'evt-1' } } };

    beforeEach(async () => {
        notificationRepo = {
            create: jest.fn((dto: any) => dto),
            save: jest.fn((e: any) => Promise.resolve(e)),
        };
        processedRepo = { insert: jest.fn().mockResolvedValue(undefined) };
        doctorRepo = { findOne: jest.fn().mockResolvedValue({ fullName: 'Omar Ahmed' }) };

        const mod: TestingModule = await Test.createTestingModule({
            providers: [
                FavoriteNotificationConsumer,
                { provide: getRepositoryToken(NotificationEntity), useValue: notificationRepo },
                { provide: getRepositoryToken(ProcessedEventEntity), useValue: processedRepo },
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepo },
            ],
        }).compile();
        consumer = mod.get(FavoriteNotificationConsumer);
    });

    it('writes one notification', async () => {
        await consumer.handleFavorited(msg, amqpMsg);

        expect(processedRepo.insert).toHaveBeenCalledWith({ eventId: 'evt-1', eventType: 'doctor.favorited' });
        expect(notificationRepo.save).toHaveBeenCalledTimes(1);
        expect(notificationRepo.save.mock.calls[0][0].message).toBe('Dr. Omar Ahmed has been added to favorite');
    });

    it('double delivery writes only one notification', async () => {
        await consumer.handleFavorited(msg, amqpMsg);
        processedRepo.insert.mockRejectedValueOnce({ code: '23505' });
        await consumer.handleFavorited(msg, amqpMsg);

        expect(notificationRepo.save).toHaveBeenCalledTimes(1);
    });

    it('consumer throw never breaks fav (acks)', async () => {
        notificationRepo.save.mockRejectedValueOnce(new Error('db down'));
        await expect(consumer.handleFavorited(msg, amqpMsg)).resolves.toBeUndefined();
    });
});
