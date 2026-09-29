import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('slot_holds')
export class SlotHold {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    userId: string;

    @Column()
    slotId: string;

    @Column()
    doctorId: string;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    frozenPrice: number;

    @Column()
    expiresAt: Date;

    @Column({ default: false })
    isConsumed: boolean;

    @CreateDateColumn()
    createdAt: Date;
}