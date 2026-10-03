import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { PrescriptionEntity } from './entities/prescription.entity';
import { LocalPrescriptionStorageService } from './local-prescription-storage.service';
import { AttachPrescriptionUseCase } from './use-case/attach-prescription.use-case';
import { PrescriptionService, mintDownloadToken, verifyDownloadToken } from './prescription.service';
import { PrescriptionNotificationConsumer } from 'src/modules/notification/consumers/prescription-notification.consumer';

describe('Prescription tracer (ENG-6 Task 1, mocked persistence)', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const patientId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);

  let storageDir: string;
  let storage: LocalPrescriptionStorageService;
  let savedOutbox: { exchange: string; eventType: string; payload: Record<string, unknown> } | null;
  let useCase: AttachPrescriptionUseCase;
  let manager: { getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let outboxProcessor: { triggerPublish: jest.Mock };

  const completedAppointment = {
    id: appointmentId,
    patientId,
    doctorId: '44444444-4444-4444-8444-444444444444',
    clinicId: '55555555-5555-4555-8555-555555555555',
    status: AppointmentStatus.COMPLETED,
  };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'tracer-test-secret';
    savedOutbox = null;
    storageDir = mkdtempSync(join(tmpdir(), 'prescription-tracer-'));
    process.env.PRESCRIPTION_STORAGE_PATH = storageDir;
    storage = new LocalPrescriptionStorageService();

    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(completedAppointment),
    };
    const appointmentRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
    const prescriptionRepo = {
      save: jest.fn().mockImplementation((row) =>
        Promise.resolve({ ...row, id: '66666666-6666-4666-8666-666666666666' }),
      ),
      findOne: jest.fn(),
    };
    const outboxRepo = {
      save: jest.fn().mockImplementation((row) => {
        savedOutbox = { exchange: row.exchange, eventType: row.eventType, payload: row.payload };
        return Promise.resolve({ ...row, id: '77777777-7777-4777-8777-777777777777' });
      }),
    };
    const managerValue = {
      getRepository: jest.fn((entity) => {
        if (entity === OutboxEventEntity) return outboxRepo;
        if (entity === PrescriptionEntity) return prescriptionRepo;
        return appointmentRepo;
      }),
    };
    manager = managerValue;
    dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    outboxProcessor = { triggerPublish: jest.fn().mockResolvedValue(undefined) };
    const existingCheck = { findOne: jest.fn().mockResolvedValue(null) };

    useCase = new AttachPrescriptionUseCase(dataSource as never, storage, outboxProcessor as never, existingCheck as never);
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.PRESCRIPTION_STORAGE_PATH;
  });

  it('upload stores the file, writes the row with audit, and emits PRESCRIPTION_ISSUED on appointment_exchange', async () => {
    const prescription = await useCase.execute(appointmentId, pdfBuffer, adminId);

    expect(prescription.appointmentId).toBe(appointmentId);
    expect(prescription.patientId).toBe(patientId);
    expect(prescription.uploadedBy).toBe(adminId);
    expect(prescription.uploadedAt).toBeInstanceOf(Date);
    expect(prescription.mimeType).toBe('application/pdf');

    const stored = await storage.read(prescription.storageKey);
    expect(stored.equals(pdfBuffer)).toBe(true);

    expect(savedOutbox).not.toBeNull();
    expect(savedOutbox?.exchange).toBe('appointment_exchange');
    expect(savedOutbox?.eventType).toBe('PRESCRIPTION_ISSUED');
    expect(savedOutbox?.payload).toEqual(
      expect.objectContaining({
        prescriptionId: prescription.id,
        appointmentId,
        patientId,
        issuedBy: adminId,
      }),
    );

    const scopedEntities = manager.getRepository.mock.calls.map(([entity]) => entity);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(scopedEntities).toContain(PrescriptionEntity);
    expect(scopedEntities).toContain(OutboxEventEntity);
    expect(outboxProcessor.triggerPublish).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777');
  });

  it('a failed event write fails the upload and cleans the file', async () => {
    const failingManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === OutboxEventEntity) {
          return { save: jest.fn().mockRejectedValue(new Error('outbox down')) };
        }
        if (entity === PrescriptionEntity) {
          return { save: jest.fn().mockImplementation((row) => Promise.resolve({ ...row, id: 'p-1' })) };
        }
        return {
          createQueryBuilder: jest.fn().mockReturnValue({
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(completedAppointment),
          }),
        };
      }),
    };
    const failingDataSource = { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(failingManager)) };
    const failing = new AttachPrescriptionUseCase(
      failingDataSource as never,
      storage,
      outboxProcessor as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
    );

    await expect(failing.execute(appointmentId, pdfBuffer, adminId)).rejects.toThrow('outbox down');
    expect(outboxProcessor.triggerPublish).not.toHaveBeenCalled();
  });

  it('consumer creates the patient inbox entry and the download link streams identical bytes', async () => {
    const prescription = await useCase.execute(appointmentId, pdfBuffer, adminId);

    const sendNotification = { execute: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    const processed = { insert: jest.fn().mockResolvedValue({}) };
    const consumer = new PrescriptionNotificationConsumer(sendNotification as never, processed as never);

    await consumer.handleIssued(
      {
        prescriptionId: prescription.id,
        appointmentId,
        patientId,
        doctorId: completedAppointment.doctorId,
        clinicId: completedAppointment.clinicId,
        issuedAt: new Date().toISOString(),
        issuedBy: adminId,
      },
      { properties: { headers: { 'x-event-id': 'evt-tracer-1' } } } as never,
    );

    expect(processed.insert).toHaveBeenCalledWith({ eventId: 'evt-tracer-1', eventType: 'PRESCRIPTION_ISSUED' });
    expect(sendNotification.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: patientId }),
    );

    const { token } = mintDownloadToken(prescription.id);
    expect(verifyDownloadToken(token)).toBe(prescription.id);

    const prescriptionsRepo = {
      findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, string> }) => {
        if (where.id) return Promise.resolve(prescription);
        return Promise.resolve(prescription);
      }),
    };
    const appointmentsRepo = { findOne: jest.fn().mockResolvedValue(completedAppointment) };
    const service = new PrescriptionService(
      prescriptionsRepo as never,
      appointmentsRepo as never,
      storage,
      useCase,
      { execute: jest.fn() } as never,
    );

    const link = await service.linkFor(patientId, 'PATIENT', appointmentId);
    const linkToken = new URL(link.url, 'http://localhost').searchParams.get('token') ?? '';
    const downloaded = await service.downloadFor(patientId, 'PATIENT', linkToken);

    expect(downloaded.mimeType).toBe('application/pdf');
    expect(downloaded.buffer.equals(pdfBuffer)).toBe(true);
  });

  it('a forged download token is refused', () => {
    const { token } = mintDownloadToken('66666666-6666-4666-8666-666666666666');
    const forged = `${token.slice(0, -2)}ab`;
    expect(() => verifyDownloadToken(forged)).toThrow();
  });
});
