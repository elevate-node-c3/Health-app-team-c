import { UnprocessableEntityException } from '@nestjs/common';
import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';

export type AllowedPrescriptionMime = 'application/pdf' | 'image/png' | 'image/jpeg';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

export function detectAllowedMime(buffer: Buffer): AllowedPrescriptionMime | null {
  if (startsWith(buffer, PDF_MAGIC)) return 'application/pdf';
  if (startsWith(buffer, PNG_MAGIC)) return 'image/png';
  if (startsWith(buffer, JPEG_MAGIC)) return 'image/jpeg';
  return null;
}

export function mimeToExtension(mime: AllowedPrescriptionMime): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  return 'jpg';
}

export function assertCompleted(status: AppointmentStatus): void {
  if (status === AppointmentStatus.COMPLETED) return;
  throw new UnprocessableEntityException({
    code: 'PRESCRIPTION_NOT_COMPLETED',
    messageKey: 'errors.prescription.not_completed',
    message: 'Prescriptions can only be attached to completed appointments',
  });
}
