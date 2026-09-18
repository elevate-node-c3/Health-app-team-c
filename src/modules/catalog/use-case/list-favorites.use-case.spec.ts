import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ListFavoritesUseCase } from './list-favorites.use-case';
import { DoctorEntity } from '../entities/doctor.entity';
import { FavoriteEntity } from '../entities/favorite.entity';

describe('ListFavoritesUseCase (CAT-7)', () => {
  let useCase: ListFavoritesUseCase;
  let favoriteRepo: any;
  let doctorRepo: any;

  const favorites = [
    { userId: 'user-1', doctorId: 'doc-1', createdAt: new Date('2026-01-01') },
    { userId: 'user-1', doctorId: 'doc-missing', createdAt: new Date('2026-01-02') },
  ];

  const rows = [
    {
      id: 'doc-1',
      fullName: 'Omar Ahmed',
      specialtyName: 'Cardiology',
      consultationFee: '200.00',
      averageRating: '4.50',
      photoUrl: null,
      isVerified: true,
    },
  ];

  function mockQueryBuilder(returnRows: any[]) {
    const qb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(returnRows),
    };
    doctorRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  beforeEach(async () => {
    favoriteRepo = { find: jest.fn().mockResolvedValue(favorites) };
    doctorRepo = { createQueryBuilder: jest.fn() };
    mockQueryBuilder(rows);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ListFavoritesUseCase,
        { provide: getRepositoryToken(FavoriteEntity), useValue: favoriteRepo },
        { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepo },
      ],
    }).compile();
    useCase = mod.get(ListFavoritesUseCase);
  });

  it('returns only the requesting user favorites', async () => {
    await useCase.execute('user-1');

    expect(favoriteRepo.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('maps verified doctors to cards and missing ones to deactivated stubs', async () => {
    const res = await useCase.execute('user-1');

    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({ doctorId: 'doc-1', isFavorite: true, isDeactivated: false });
    expect(res.data[1]).toEqual({
      doctorId: 'doc-missing',
      isFavorite: true,
      isDeactivated: true,
      favoritedAt: favorites[1].createdAt,
    });
  });

  it('returns empty data when user has no favorites', async () => {
    favoriteRepo.find.mockResolvedValueOnce([]);

    const res = await useCase.execute('user-1');

    expect(res).toEqual({ message: 'Favorites retrieved successfully', data: [] });
    expect(doctorRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
