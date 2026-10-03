import { AppointmentStatus } from 'src/modules/catalog/entities/appointment.entity';
import { assertCompleted, detectAllowedMime, mimeToExtension } from './prescription-policy';

describe('PrescriptionPolicy', () => {
  describe('detectAllowedMime', () => {
    it('accepts a real PDF by magic bytes', () => {
      expect(detectAllowedMime(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('application/pdf');
    });

    it('accepts a real PNG by magic bytes', () => {
      expect(
        detectAllowedMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
      ).toBe('image/png');
    });

    it('accepts a real JPEG by magic bytes', () => {
      expect(detectAllowedMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    });

    it('refuses a text file renamed to .pdf', () => {
      expect(detectAllowedMime(Buffer.from('hello, this is plain text'))).toBeNull();
    });

    it('refuses truncated magic bytes', () => {
      expect(detectAllowedMime(Buffer.from([0x25, 0x50]))).toBeNull();
      expect(detectAllowedMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeNull();
      expect(detectAllowedMime(Buffer.from([]))).toBeNull();
    });

    it('accepts the minimal three-byte JPEG magic', () => {
      expect(detectAllowedMime(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    });

    it('maps each mime to its server-side extension', () => {
      expect(mimeToExtension('application/pdf')).toBe('pdf');
      expect(mimeToExtension('image/png')).toBe('png');
      expect(mimeToExtension('image/jpeg')).toBe('jpg');
    });
  });

  describe('assertCompleted', () => {
    it('allows COMPLETED', () => {
      expect(() => assertCompleted(AppointmentStatus.COMPLETED)).not.toThrow();
    });

    it.each([AppointmentStatus.BOOKED, AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW])(
      'refuses %s with PRESCRIPTION_NOT_COMPLETED',
      (status) => {
        let code: string | undefined;
        try {
          assertCompleted(status);
        } catch (err) {
          code = (err as { response?: { code?: string } }).response?.code;
        }
        expect(code).toBe('PRESCRIPTION_NOT_COMPLETED');
      },
    );
  });
});
