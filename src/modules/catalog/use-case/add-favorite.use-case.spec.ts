import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AddFavoriteUseCase } from './add-favorite.use-case';
import { DoctorEntity } from '../entities/doctor.entity';

jest.mock('../../../common/outbox/services/outbox-processor.service', () => ({
    OutboxProcessorService: class {},
}));
import { OutboxProcessorService } from '../../../common/outbox/services/outbox-processor.service';

describe('AddFavoriteUseCase (CAT-7)', () => {
    let useCase: AddFavoriteUseCase;
    let doctorRepo: any;
    let queryRunner: any;
    let dataSource: any;
    let outboxProcessor: any;

    const doctor = { id: 'doc-1', fullName: 'Omar Ahmed' };

    beforeEach(async () => {
        doctorRepo = { findOne: jest.fn().mockResolvedValue(doctor) };

        queryRunner = {
            connect: jest.fn(),
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(),
            release: jest.fn(),
            manager: {
                findOne: jest.fn(),
                create: jest.fn((_: any, dto: any) => dto),
                save: jest.fn(() => Promise.resolve({ id: 'evt-1' })),
            },
        };
        dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
        outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) };

        const mod: TestingModule = await Test.createTestingModule({
            providers: [
                AddFavoriteUseCase,
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepo },
                { provide: DataSource, useValue: dataSource },
                { provide: OutboxProcessorService, useValue: outboxProcessor },
            ],
        }).compile();
        useCase = mod.get(AddFavoriteUseCase);
    });

    it('adds favorite and publishes event', async () => {
        queryRunner.manager.findOne.mockResolvedValue(null);

        const res = await useCase.execute('user-1', 'doc-1');

        expect(res.data.isFavorite).toBe(true);
        expect(res.message).toBe('Doctor added to favorites');
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
        await new Promise((r) => setImmediate(r));
        expect(outboxProcessor.triggerPublish).toHaveBeenCalledWith('evt-1');
    });

    it('duplicate fav is idempotent, no second event', async () => {
        queryRunner.manager.findOne.mockResolvedValue({ userId: 'user-1', doctorId: 'doc-1' });

        const res = await useCase.execute('user-1', 'doc-1');

        expect(res.message).toBe('Doctor already in favorites');
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
        await new Promise((r) => setImmediate(r));
        expect(outboxProcessor.triggerPublish).not.toHaveBeenCalled();
    });

    it('race 23505 treated as success', async () => {
        queryRunner.manager.findOne.mockResolvedValue(null);
        queryRunner.manager.save.mockRejectedValueOnce({ code: '23505', message: 'duplicate key' });

        const res = await useCase.execute('user-1', 'doc-1');

        expect(res.message).toBe('Doctor already in favorites');
        expect(queryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('unknown doctor throws', async () => {
        doctorRepo.findOne.mockResolvedValue(null);
        await expect(useCase.execute('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
});
