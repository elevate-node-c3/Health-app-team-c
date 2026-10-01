import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export enum RefundStatus {
    PENDING = 'PENDING',
    ISSUED = 'ISSUED',
    SETTLED = 'SETTLED',
    FAILED = 'FAILED',
}

@Entity('refunds')
export class RefundEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ type: 'uuid' })
    appointmentId: string;

    @Column({ type: 'uuid' })
    paymentTransactionId: string;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    amount: number;

    @Index()
    @Column({ type: 'enum', enum: RefundStatus, default: RefundStatus.PENDING })
    status: RefundStatus;

    @Column({ unique: true })
    idempotencyKey: string;

    @Column({ type: 'varchar', nullable: true })
    providerRefundId: string | null;

    @Column({ type: 'varchar', nullable: true })
    failureReason: string | null;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    @Column({ type: 'timestamptz', nullable: true })
    lastAttemptAt: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    issuedAt: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    expectedArrivalAt: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    settledAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}