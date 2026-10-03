import { mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from './entities/prescription.entity';
import { LocalPrescriptionStorageService } from './local-prescription-storage.service';
import { AttachPrescriptionUseCase } from './use-case/attach-prescription.use-case';
import { CancelAppointmentUseCase } from 'src/modules/booking/use-case/cancel-appointment.use-case';
import { CompletionDecision, decideCompletion } from 'src/modules/booking/policies/completion-policy';

describe('Prescription orphans and late lifecycle (ENG-6 Task 3)', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const patientId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  let storageDir: string;
  let storage: LocalPrescriptionStorageService;

  beforeEach(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'prescription-orphan-'));
    process.env.PRESCRIPTION_STORAGE_PATH = storageDir;
    storage = new LocalPrescriptionStorageService();
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.PRESCRIPTION_STORAGE_PATH;
  });

  function attachWith(appointment: Record<string, unknown>, failTransactionWith: unknown = null) {
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(appointment),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === OutboxEventEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'event-1' })) };
        }
        if (entity === PrescriptionEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'prescription-1' })) };
        }
        return { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
      }),
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => {
        if (failTransactionWith) return Promise.reject(failTransactionWith);
        return cb(manager);
      }),
    } as unknown as DataSource;
    const outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) } as never;
    const existingCheck = { findOne: jest.fn().mockResolvedValue(null) };
    return new AttachPrescriptionUseCase(dataSource, storage, outboxProcessor, existingCheck as never);
  }

  function storedFiles(): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(storageDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        files.push(entry.name);
      } else {
        for (const nested of readdirSync(join(storageDir, entry.name))) files.push(join(entry.name, nested));
      }
    }
    return files;
  }

  it('a failed DB transaction leaves no orphan file behind', async () => {
    const completed = {
      id: appointmentId,
      patientId,
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
    };

    await expect(
      attachWith(completed, { code: '23505' }).execute(appointmentId, pdfBuffer, adminId),
    ).rejects.toMatchObject({ response: { code: 'PRESCRIPTION_ALREADY_EXISTS' } });
    expect(storedFiles()).toEqual([]);
  });

  it('a cancelled-after-attach attempt is refused and the prescription stays downloadable', async () => {
    const completed = {
      id: appointmentId,
      patientId,
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
      date: '2026-09-01',
      startTime: '10:00:00',
    };
    const prescription = await attachWith({ ...completed }).execute(appointmentId, pdfBuffer, adminId);

    const cancelQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...completed }),
    };
    const cancelManager = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(cancelQb),
        save: jest.fn(),
      }),
    };
    const cancelDataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(cancelManager)) } as unknown as DataSource;
    const cancel = new CancelAppointmentUseCase(
      cancelDataSource,
      { createPendingRefund: jest.fn(), processRefund: jest.fn() } as never,
      { cancelForAppointment: jest.fn() } as never,
    );

    await expect(cancel.execute(appointmentId, patientId)).rejects.toThrow();
    expect((await storage.read(prescription.storageKey)).equals(pdfBuffer)).toBe(true);
  });

  it('a clock-completed BOOKED appointment accepts a prescription', async () => {
    const startedThirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(decideCompletion(startedThirtyMinutesAgo)).toBe(CompletionDecision.COMPLETED);

    const nowCompleted = {
      id: appointmentId,
      patientId,
      doctorId: '44444444-4444-4444-8444-444444444444',
      clinicId: '55555555-5555-4555-8555-555555555555',
      status: AppointmentStatus.COMPLETED,
    };
    const prescription = await attachWith(nowCompleted).execute(appointmentId, pdfBuffer, adminId);

    expect(prescription.appointmentId).toBe(appointmentId);
    expect((await storage.read(prescription.storageKey)).equals(pdfBuffer)).toBe(true);
  });
});
