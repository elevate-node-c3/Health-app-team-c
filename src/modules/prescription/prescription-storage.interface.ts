export const PRESCRIPTION_STORAGE = 'PRESCRIPTION_STORAGE';

export interface PrescriptionStorage {
  save(key: string, buffer: Buffer, mime: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
