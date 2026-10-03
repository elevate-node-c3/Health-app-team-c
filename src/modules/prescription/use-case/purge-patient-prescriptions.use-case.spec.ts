import { PurgePatientPrescriptionsUseCase } from './purge-patient-prescriptions.use-case';

describe('PurgePatientPrescriptionsUseCase', () => {
  const patientId = '22222222-2222-4222-8222-222222222222';

  let useCase: PurgePatientPrescriptionsUseCase;
  let prescriptions: { find: jest.Mock; delete: jest.Mock };
  let storage: { delete: jest.Mock };

  beforeEach(() => {
    prescriptions = { find: jest.fn(), delete: jest.fn().mockResolvedValue({}) };
    storage = { delete: jest.fn().mockResolvedValue(undefined) };
    useCase = new PurgePatientPrescriptionsUseCase(prescriptions as never, storage as never);
  });

  it('deletes every row and file of the patient and reports the count', async () => {
    prescriptions.find.mockResolvedValue([
      { id: 'p-1', storageKey: 'a/old-1.pdf' },
      { id: 'p-2', storageKey: 'a/old-2.png' },
    ]);

    const result = await useCase.execute(patientId);

    expect(result).toEqual({ deleted: 2 });
    expect(storage.delete).toHaveBeenCalledWith('a/old-1.pdf');
    expect(storage.delete).toHaveBeenCalledWith('a/old-2.png');
    expect(prescriptions.delete).toHaveBeenCalledWith({ patientId });
  });

  it('deletes nothing when the patient has no prescriptions', async () => {
    prescriptions.find.mockResolvedValue([]);

    const result = await useCase.execute(patientId);

    expect(result).toEqual({ deleted: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(prescriptions.delete).not.toHaveBeenCalled();
  });

  it('still removes rows when a file is already gone', async () => {
    prescriptions.find.mockResolvedValue([{ id: 'p-1', storageKey: 'a/old-1.pdf' }]);
    storage.delete.mockRejectedValueOnce(new Error('file missing'));

    const result = await useCase.execute(patientId);

    expect(result).toEqual({ deleted: 1 });
    expect(prescriptions.delete).toHaveBeenCalledWith({ patientId });
  });

  it('scopes deletion to the requesting patient only', async () => {
    prescriptions.find.mockResolvedValue([]);

    await useCase.execute(patientId);

    expect(prescriptions.find).toHaveBeenCalledWith({ where: { patientId } });
  });
});
