import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

@Entity('prescriptions')
@Unique(['appointmentId'])
export class PrescriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  appointmentId: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @Column({ type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ type: 'varchar', length: 50 })
  mimeType: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'uuid' })
  uploadedBy: string;

  @Column({ type: 'timestamptz' })
  uploadedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  replacedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  replacedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
