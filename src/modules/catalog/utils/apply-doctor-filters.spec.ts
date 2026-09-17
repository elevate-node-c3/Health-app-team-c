import { BadRequestException } from '@nestjs/common';
import { applyDoctorFilters, getCairoDayToken } from './apply-doctor-filters';

function mockQb() {
  return {
    andWhere: jest.fn().mockReturnThis(),
    andHaving: jest.fn().mockReturnThis(),
  } as any;
}

describe('applyDoctorFilters (CAT-5)', () => {
  it('empty filters add no conditions', () => {
    const qb = mockQb();
    applyDoctorFilters(qb, {});
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.andHaving).not.toHaveBeenCalled();
  });

  it('both genders add no gender condition, single gender does', () => {
    const both = mockQb();
    applyDoctorFilters(both, { genders: ['Male', 'Female'] as any });
    expect(both.andWhere.mock.calls.some((c: any[]) => String(c[0]).includes('gender'))).toBe(false);

    const single = mockQb();
    applyDoctorFilters(single, { genders: ['Male'] as any });
    expect(single.andWhere).toHaveBeenCalledWith('doctor.gender IN (:...genders)', { genders: ['Male'] });
  });

  it('rating filters with greater-or-equal', () => {
    const qb = mockQb();
    applyDoctorFilters(qb, { rating: 3 });
    expect(qb.andWhere).toHaveBeenCalledWith('doctor.averageRating >= :rating', { rating: 3 });
  });

  it('min greater than max is rejected naming the field', () => {
    expect(() => applyDoctorFilters(mockQb(), { minPrice: 500, maxPrice: 200 })).toThrow(BadRequestException);
    try {
      applyDoctorFilters(mockQb(), { minPrice: 500, maxPrice: 200 });
    } catch (err: any) {
      expect(JSON.stringify(err.getResponse())).toContain('minPrice');
    }
  });

  it('max of 1000 keeps doctors charging above 1000', () => {
    const qb = mockQb();
    applyDoctorFilters(qb, { minPrice: 200, maxPrice: 1000 });
    const havingCalls = qb.andHaving.mock.calls.map((c: any[]) => String(c[0]));
    expect(havingCalls.some((s: string) => s.includes('>= :minPrice'))).toBe(true);
    expect(havingCalls.some((s: string) => s.includes('<= :maxPrice') || s.includes('BETWEEN'))).toBe(false);
  });

  it('max below 1000 bounds both sides', () => {
    const qb = mockQb();
    applyDoctorFilters(qb, { minPrice: 100, maxPrice: 500 });
    expect(qb.andHaving.mock.calls.map((c: any[]) => String(c[0])).join(' ')).toContain('BETWEEN');
  });

  it('availability today uses the Cairo weekday token', () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const token = getCairoDayToken(now);
    const qb = mockQb();
    applyDoctorFilters(qb, { availability: ['Today'] as any }, now);
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('EXISTS'), { availDays: [token] });
  });

  it('tomorrow near Cairo midnight resolves to the Cairo next day', () => {
    const lateNight = new Date('2026-09-14T21:30:00Z');
    const qb = mockQb();
    applyDoctorFilters(qb, { availability: ['Tomorrow'] as any }, lateNight);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS'),
      { availDays: [getCairoDayToken(new Date(lateNight.getTime() + 24 * 60 * 60 * 1000))] },
    );
  });
});
