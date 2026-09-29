import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SlotHoldStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CONSUMED = 'CONSUMED',
}

@Entity('slot_holds')
@Index(['doctorId', 'clinicId', 'date', 'startTime'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
export class SlotHoldEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  doctorId: string;

  @Column({ type: 'uuid' })
  clinicId: string;

  @Column({ type: 'uuid' })
  patientId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  frozenFee: number;

  @Column({ type: 'enum', enum: SlotHoldStatus, default: SlotHoldStatus.ACTIVE })
  status: SlotHoldStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  extendedOnce: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
