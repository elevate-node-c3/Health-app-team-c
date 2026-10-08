import { UserStatus } from 'src/modules/auth/entities/user.entity';
import { PrescriptionService, mintDownloadToken } from './prescription.service';

describe('PrescriptionService scoping (ENG-7 Task 4)', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const patientId = '22222222-2222-4222-8222-222222222222';
  const otherId = '99999999-9999-4999-8999-999999999999';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const appointment = { id: appointmentId, patientId };

  let service: PrescriptionService;
  let prescriptions: { findOne: jest.Mock };
  let appointments: { findOne: jest.Mock };
  let storage: { read: jest.Mock };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'service-spec-secret';
    prescriptions = { findOne: jest.fn() };
    appointments = { findOne: jest.fn().mockResolvedValue(appointment) };
    storage = { read: jest.fn().mockResolvedValue(pdfBuffer) };
    service = new PrescriptionService(
      prescriptions as never,
      appointments as never,
      storage as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );
  });

  it('lets the owner read metadata', async () => {
    prescriptions.findOne.mockResolvedValue({
      mimeType: 'application/pdf',
      sizeBytes: 4,
      uploadedAt: new Date(),
    });

    const result = await service.metadataFor(patientId, UserStatus.PATIENT, appointmentId);

    expect(result).toEqual(expect.objectContaining({ hasPrescription: true, mimeType: 'application/pdf' }));
  });

  it('returns 404 not 403 for another user', async () => {
    await expect(service.metadataFor(otherId, UserStatus.PATIENT, appointmentId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_APPOINTMENT_NOT_FOUND' },
    });
    expect(prescriptions.findOne).not.toHaveBeenCalled();
  });

  it('lets ADMIN read another patient metadata', async () => {
    prescriptions.findOne.mockResolvedValue({
      mimeType: 'application/pdf',
      sizeBytes: 4,
      uploadedAt: new Date(),
    });

    const result = await service.metadataFor('admin1', UserStatus.ADMIN, appointmentId);

    expect(result.hasPrescription).toBe(true);
  });

  it('returns PRESCRIPTION_NOT_FOUND for link without a file', async () => {
    prescriptions.findOne.mockResolvedValue(null);

    await expect(service.linkFor(patientId, UserStatus.PATIENT, appointmentId)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_NOT_FOUND' },
    });
  });

  it('round-trips owner download bytes', async () => {
    const row = { id: 'presc-1', appointmentId, mimeType: 'application/pdf', sizeBytes: 4 };
    prescriptions.findOne.mockResolvedValue(row);

    const link = await service.linkFor(patientId, UserStatus.PATIENT, appointmentId);
    const token = new URL(link.url, 'http://localhost').searchParams.get('token') ?? '';
    const downloaded = await service.downloadFor(patientId, UserStatus.PATIENT, token);

    expect(downloaded.buffer.equals(pdfBuffer)).toBe(true);
  });

  it('refuses a forged token with 403', async () => {
    const { token } = mintDownloadToken('presc-1');

    await expect(service.downloadFor(patientId, UserStatus.PATIENT, `${token.slice(0, -2)}ab`)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses missing and array tokens with 400', async () => {
    await expect(service.downloadFor(patientId, UserStatus.PATIENT, '')).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_LINK_INVALID' },
    });
    await expect(service.downloadFor(patientId, UserStatus.PATIENT, ['a', 'b'])).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_LINK_INVALID' },
    });
  });
});
