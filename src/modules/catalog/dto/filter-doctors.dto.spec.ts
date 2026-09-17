import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FilterDoctorsDto } from './filter-doctors.dto';

async function errorsOf(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(FilterDoctorsDto, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('FilterDoctorsDto (CAT-5)', () => {
  it('accepts empty filters', async () => {
    await expect(errorsOf({})).resolves.toEqual([]);
  });

  it('accepts comma-separated multi values', async () => {
    const dto = plainToInstance(FilterDoctorsDto, { genders: 'Male,Female', titles: 'Professor,Consultant' });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.genders).toEqual(['Male', 'Female']);
  });

  it('rejects unknown gender', async () => {
    const errors = await errorsOf({ genders: 'Unknown' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown place type', async () => {
    const errors = await errorsOf({ places: 'pharmacy' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects rating of 9', async () => {
    const errors = await errorsOf({ rating: 9 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects negative price', async () => {
    const errors = await errorsOf({ minPrice: -5 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-uuid specialty', async () => {
    const errors = await errorsOf({ specialtyId: 'not-a-uuid' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
