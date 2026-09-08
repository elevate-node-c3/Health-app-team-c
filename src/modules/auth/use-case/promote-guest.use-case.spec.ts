import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PromoteGuestUseCase } from './promote-guest.use-case';
import { GuestSearchEntity } from '../entities/guest-search.entity';
import { UserSearchEntity } from '../entities/user-search.entity';
import { GuestPromotionEntity } from '../entities/guest-promotion.entity';

describe('PromoteGuestUseCase (AUTH-6)', () => {
    let useCase: PromoteGuestUseCase;
    let guestRepo: any;
    let userRepo: any;
    let promoRepo: any;

    beforeEach(async () => {
        guestRepo = { find: jest.fn() };
        userRepo = { find: jest.fn(), create: jest.fn((dto) => dto), save: jest.fn((e) => Promise.resolve(e)) };
        promoRepo = { findOne: jest.fn(), create: jest.fn((dto) => dto), save: jest.fn((e) => Promise.resolve(e)) };

        const mod: TestingModule = await Test.createTestingModule({
            providers: [
                PromoteGuestUseCase,
                { provide: getRepositoryToken(GuestSearchEntity), useValue: guestRepo },
                { provide: getRepositoryToken(UserSearchEntity), useValue: userRepo },
                { provide: getRepositoryToken(GuestPromotionEntity), useValue: promoRepo },
            ],
        }).compile();
        useCase = mod.get(PromoteGuestUseCase);
    });

    it('migrates guest searches to user - basic', async () => {
        promoRepo.findOne.mockResolvedValue(null);
        guestRepo.find.mockResolvedValue([{ searchQuery: 'Dentist' }, { searchQuery: 'Cardiology' }]);
        userRepo.find.mockResolvedValue([]);
        const res = await useCase.execute({ guestDeviceId: 'dev-1', userId: 'user-1' });
        expect(res.migratedCount).toBe(2);
        expect(userRepo.save).toHaveBeenCalledTimes(2);
    });

    it('merge never overwrite - dedup normalized', async () => {
        promoRepo.findOne.mockResolvedValue(null);
        guestRepo.find.mockResolvedValue([{ searchQuery: 'Dentist' }, { searchQuery: 'dentist ' }, { searchQuery: '  DENTIST' }, { searchQuery: 'Cardio' }]);
        userRepo.find.mockResolvedValue([{ searchQuery: 'dentist' }]);
        const res = await useCase.execute({ guestDeviceId: 'dev-1', userId: 'user-1' });
        expect(res.migratedCount).toBe(1); // only Cardio
    });

    it('idempotent - second run same device+user no duplicates', async () => {
        promoRepo.findOne.mockResolvedValue({ deviceId: 'dev-1', userId: 'user-1' });
        guestRepo.find.mockResolvedValue([{ searchQuery: 'Dentist' }]);
        userRepo.find.mockResolvedValue([{ searchQuery: 'Dentist' }]);
        const res = await useCase.execute({ guestDeviceId: 'dev-1', userId: 'user-1' });
        expect(res.migratedCount).toBe(0);
    });

    it('nothing is stolen - already claimed by other user', async () => {
        promoRepo.findOne.mockResolvedValue({ deviceId: 'dev-1', userId: 'other-user' });
        const res = await useCase.execute({ guestDeviceId: 'dev-1', userId: 'user-1' });
        expect(res.skipped).toBe('GUEST_ALREADY_CLAIMED');
        expect(res.migratedCount).toBe(0);
        expect(guestRepo.find).not.toHaveBeenCalled();
    });

    it('no deviceId -> no-op, registration still succeeds', async () => {
        const res = await useCase.execute({ guestDeviceId: '', userId: 'user-1' });
        expect(res.migratedCount).toBe(0);
        expect(res.skipped).toBe('NO_DEVICE_ID');
    });

    it('unique violation race handled', async () => {
        promoRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ deviceId: 'dev-1', userId: 'other' });
        promoRepo.save.mockRejectedValueOnce({ code: '23505', message: 'duplicate key' });
        const res = await useCase.execute({ guestDeviceId: 'dev-1', userId: 'user-1' });
        expect(res.skipped).toBe('GUEST_ALREADY_CLAIMED');
    });
});
