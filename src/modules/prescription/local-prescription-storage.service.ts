import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { PrescriptionStorage } from './prescription-storage.interface';

export function prescriptionStoragePath(): string {
  return process.env.PRESCRIPTION_STORAGE_PATH ?? './storage/prescriptions';
}

@Injectable()
export class LocalPrescriptionStorageService implements PrescriptionStorage, OnModuleInit {
  private readonly logger = new Logger(LocalPrescriptionStorageService.name);
  private readonly basePath = prescriptionStoragePath();

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async save(key: string, buffer: Buffer, mime: string): Promise<void> {
    const path = this.resolve(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, buffer);
    this.logger.log(`Prescription file stored key=${key} sizeBytes=${buffer.length} mime=${mime}`);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    return join(this.basePath, key);
  }
}
