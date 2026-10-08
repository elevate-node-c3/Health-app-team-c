import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { PrescriptionEntity } from './entities/prescription.entity';
import { PRESCRIPTION_STORAGE, PrescriptionStorage } from './prescription-storage.interface';
import { AttachPrescriptionUseCase } from './use-case/attach-prescription.use-case';
import { ReplacePrescriptionUseCase } from './use-case/replace-prescription.use-case';
import { PrescriptionLinkDto } from './dto/prescription-link.dto';
import { PrescriptionMetadataDto } from './dto/prescription-metadata.dto';

export function prescriptionLinkTtlSeconds(): number {
  const parsed = Number(process.env.PRESCRIPTION_LINK_TTL_SECONDS ?? '300');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

function linkSigningKey(): string {
  const key = process.env.JWT_ACCESS_SECRET;
  if (!key) throw new Error('JWT_ACCESS_SECRET is not defined in environment variables.');
  return key;
}

export function mintDownloadToken(prescriptionId: string, ttlSeconds: number = prescriptionLinkTtlSeconds(), nowMs: number = Date.now()): { token: string; expiresAt: Date } {
  const expiresAt = new Date(nowMs + ttlSeconds * 1000);
  const body = `${prescriptionId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  const signature = createHmac('sha256', linkSigningKey()).update(body).digest('hex');
  const token = Buffer.from(`${body}.${signature}`).toString('base64url');
  return { token, expiresAt };
}

export function verifyDownloadToken(token: string, nowMs: number = Date.now()): string {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new ForbiddenException({
      code: 'PRESCRIPTION_LINK_INVALID',
      messageKey: 'errors.prescription.link_invalid',
      message: 'Download link is invalid or expired',
    });
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) {
    throw new ForbiddenException({
      code: 'PRESCRIPTION_LINK_INVALID',
      messageKey: 'errors.prescription.link_invalid',
      message: 'Download link is invalid or expired',
    });
  }
  const [prescriptionId, expiresAtUnix, signature] = parts;
  const expected = createHmac('sha256', linkSigningKey()).update(`${prescriptionId}.${expiresAtUnix}`).digest('hex');
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  const valid =
    actual.length === wanted.length &&
    timingSafeEqual(actual, wanted) &&
    Number(expiresAtUnix) * 1000 > nowMs;
  if (!valid) {
    throw new ForbiddenException({
      code: 'PRESCRIPTION_LINK_INVALID',
      messageKey: 'errors.prescription.link_invalid',
      message: 'Download link is invalid or expired',
    });
  }
  return prescriptionId;
}

@Injectable()
export class PrescriptionService {
  constructor(
    @InjectRepository(PrescriptionEntity)
    private readonly prescriptions: Repository<PrescriptionEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointments: Repository<AppointmentEntity>,
    @Inject(PRESCRIPTION_STORAGE)
    private readonly storage: PrescriptionStorage,
    private readonly attach: AttachPrescriptionUseCase,
    private readonly replace: ReplacePrescriptionUseCase,
  ) {}

  attachFor(adminId: string, appointmentId: string, fileBuffer: Buffer): Promise<PrescriptionEntity> {
    return this.attach.execute(appointmentId, fileBuffer, adminId);
  }

  replaceFor(adminId: string, appointmentId: string, fileBuffer: Buffer): Promise<PrescriptionEntity> {
    return this.replace.execute(appointmentId, fileBuffer, adminId);
  }

  async metadataFor(requesterId: string | undefined, role: string, appointmentId: string): Promise<PrescriptionMetadataDto> {
    const appointment = await this.loadScopedAppointment(requesterId, role, appointmentId);
    const prescription = await this.prescriptions.findOne({ where: { appointmentId: appointment.id } });
    if (!prescription) return { hasPrescription: false };
    return {
      hasPrescription: true,
      mimeType: prescription.mimeType,
      sizeBytes: prescription.sizeBytes,
      uploadedAt: prescription.uploadedAt,
    };
  }

  async linkFor(requesterId: string | undefined, role: string, appointmentId: string): Promise<PrescriptionLinkDto> {
    const appointment = await this.loadScopedAppointment(requesterId, role, appointmentId);
    const prescription = await this.prescriptions.findOne({ where: { appointmentId: appointment.id } });
    if (!prescription) {
      throw new NotFoundException({
        code: 'PRESCRIPTION_NOT_FOUND',
        messageKey: 'errors.prescription.not_found',
        message: 'No prescription exists for this appointment',
      });
    }
    const { token, expiresAt } = mintDownloadToken(prescription.id);
    return { url: `/api/v1/prescriptions/download?token=${token}`, expiresAt: expiresAt.toISOString() };
  }

  async downloadFor(requesterId: string | undefined, role: string, token: string | string[]): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
    if (!token || Array.isArray(token)) {
      throw new BadRequestException({
        code: 'PRESCRIPTION_LINK_INVALID',
        messageKey: 'errors.prescription.link_invalid',
        message: 'Download link is invalid or expired',
      });
    }
    const prescriptionId = verifyDownloadToken(token);
    const prescription = await this.prescriptions.findOne({ where: { id: prescriptionId } });
    if (!prescription) {
      throw new NotFoundException({
        code: 'PRESCRIPTION_NOT_FOUND',
        messageKey: 'errors.prescription.not_found',
        message: 'No prescription exists for this appointment',
      });
    }
    await this.loadScopedAppointment(requesterId, role, prescription.appointmentId);
    const buffer = await this.storage.read(prescription.storageKey);
    return { buffer, mimeType: prescription.mimeType, sizeBytes: prescription.sizeBytes };
  }

  private async loadScopedAppointment(requesterId: string | undefined, role: string, appointmentId: string): Promise<AppointmentEntity> {
    const appointment = await this.appointments.findOne({ where: { id: appointmentId } });
    if (!appointment) {
      throw new NotFoundException({
        code: 'PRESCRIPTION_APPOINTMENT_NOT_FOUND',
        messageKey: 'errors.prescription.appointment_not_found',
        message: 'Appointment not found',
      });
    }
    if (role !== 'ADMIN' && appointment.patientId !== requesterId) {
      throw new NotFoundException({
        code: 'PRESCRIPTION_APPOINTMENT_NOT_FOUND',
        messageKey: 'errors.prescription.appointment_not_found',
        message: 'Appointment not found',
      });
    }
    return appointment;
  }
}
