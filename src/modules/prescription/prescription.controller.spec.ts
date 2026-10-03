import { PATH_METADATA } from '@nestjs/common/constants';
import { UserStatus } from 'src/modules/auth/entities/user.entity';
import { PrescriptionController } from './prescription.controller';

describe('PrescriptionController (ENG-6 Task 2)', () => {
  const appointmentId = '11111111-1111-4111-8111-111111111111';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const patientId = '22222222-2222-4222-8222-222222222222';
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46]);

  let controller: PrescriptionController;
  let service: {
    attachFor: jest.Mock;
    replaceFor: jest.Mock;
    metadataFor: jest.Mock;
    linkFor: jest.Mock;
    downloadFor: jest.Mock;
  };

  const adminReq = { userContext: { userId: adminId, role: 'ADMIN' } };
  const patientReq = { userContext: { userId: patientId, role: 'PATIENT' } };

  beforeEach(() => {
    service = {
      attachFor: jest.fn(),
      replaceFor: jest.fn(),
      metadataFor: jest.fn(),
      linkFor: jest.fn(),
      downloadFor: jest.fn(),
    };
    controller = new PrescriptionController(service as never);
  });

  it('upload is ADMIN-only and patient reads allow PATIENT or ADMIN', () => {
    expect(Reflect.getMetadata('roles', controller.attach)).toEqual([UserStatus.ADMIN]);
    expect(Reflect.getMetadata('roles', controller.replace)).toEqual([UserStatus.ADMIN]);
    expect(Reflect.getMetadata('roles', controller.metadata)).toEqual([UserStatus.PATIENT, UserStatus.ADMIN]);
    expect(Reflect.getMetadata('roles', controller.downloadLink)).toEqual([UserStatus.PATIENT, UserStatus.ADMIN]);
    expect(Reflect.getMetadata('roles', controller.download)).toEqual([UserStatus.PATIENT, UserStatus.ADMIN]);
  });

  it('routes nothing under raw storage paths', () => {
    const methods = ['attach', 'replace', 'metadata', 'downloadLink', 'download'];
    for (const method of methods) {
      const path = Reflect.getMetadata(PATH_METADATA, controller[method]) as string | string[] | undefined;
      const paths = Array.isArray(path) ? path : [path ?? ''];
      for (const p of paths) expect(p).not.toContain('storage');
    }
    expect(Reflect.getMetadata(PATH_METADATA, PrescriptionController)).toBe('prescriptions');
  });

  it('delegates attach with the admin id, appointment id and file bytes', async () => {
    service.attachFor.mockResolvedValue({
      id: 'prescription-1',
      appointmentId,
      mimeType: 'application/pdf',
      sizeBytes: 4,
      uploadedAt: new Date(),
    });

    const result = await controller.attach({ appointmentId }, { buffer: pdfBuffer } as never, adminReq);

    expect(service.attachFor).toHaveBeenCalledWith(adminId, appointmentId, pdfBuffer);
    expect(result.data).toEqual(expect.objectContaining({ appointmentId, mimeType: 'application/pdf' }));
  });

  it('delegates replace with the admin id, appointment id and file bytes', async () => {
    service.replaceFor.mockResolvedValue({
      id: 'prescription-1',
      appointmentId,
      mimeType: 'image/png',
      sizeBytes: 4,
      uploadedAt: new Date(),
    });

    const result = await controller.replace({ appointmentId }, { buffer: pdfBuffer } as never, adminReq);

    expect(service.replaceFor).toHaveBeenCalledWith(adminId, appointmentId, pdfBuffer);
    expect(result).toEqual(expect.objectContaining({ message: 'prescription.replaced' }));
  });

  it('refuses attach and replace without a file', async () => {
    await expect(controller.attach({ appointmentId }, undefined, adminReq)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_FILE_REQUIRED' },
    });
    await expect(controller.replace({ appointmentId }, undefined, adminReq)).rejects.toMatchObject({
      response: { code: 'PRESCRIPTION_FILE_REQUIRED' },
    });
  });

  it('returns the disabled state for appointments without a prescription', async () => {
    service.metadataFor.mockResolvedValue({ hasPrescription: false });

    const result = await controller.metadata({ appointmentId }, patientReq);

    expect(service.metadataFor).toHaveBeenCalledWith(patientId, 'PATIENT', appointmentId);
    expect(result.data).toEqual({ hasPrescription: false });
  });

  it('streams download bytes with stored content type and length', async () => {
    service.downloadFor.mockResolvedValue({ buffer: pdfBuffer, mimeType: 'application/pdf', sizeBytes: 4 });
    const res = { set: jest.fn(), send: jest.fn() } as never;

    await controller.download('token-1', patientReq, res);

    expect(service.downloadFor).toHaveBeenCalledWith(patientId, 'PATIENT', 'token-1');
    expect((res as { set: jest.Mock }).set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Length': '4',
    });
    expect((res as { send: jest.Mock }).send).toHaveBeenCalledWith(pdfBuffer);
  });
});
