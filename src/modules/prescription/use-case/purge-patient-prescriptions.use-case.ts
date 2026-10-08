import { Inject, Injectable, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { PrescriptionEntity } from '../entities/prescription.entity';
import { PRESCRIPTION_STORAGE, PrescriptionStorage } from '../prescription-storage.interface';

@Injectable()
export class PurgePatientPrescriptionsUseCase {
  private readonly logger = new Logger(PurgePatientPrescriptionsUseCase.name);

  constructor(
    @InjectRepository(PrescriptionEntity)
    private readonly prescriptions: Repository<PrescriptionEntity>,
    @Inject(PRESCRIPTION_STORAGE)
    private readonly storage: PrescriptionStorage,
  ) {}

  async execute(patientId: string): Promise<{ deleted: number }> {
    const rows = await this.prescriptions.find({ where: { patientId } });
    if (rows.length > 0) {
      await this.prescriptions.delete({ patientId });
    }
    for (const row of rows) {
      await this.storage.delete(row.storageKey).catch((err: Error) => this.logger.warn(`Prescription file cleanup failed for ${row.storageKey}: ${err.message}`));
    }
    this.logger.log(`Purged ${rows.length} prescriptions for patient ${patientId}`);
    return { deleted: rows.length };
  }
}
