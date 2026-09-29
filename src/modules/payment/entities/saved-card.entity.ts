import {
    Column,
    CreateDateColumn,
    DeleteDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
    Unique,
} from 'typeorm';

export enum CardBrand {
    VISA = 'VISA',
    MASTERCARD = 'MASTERCARD',
    AMEX = 'AMEX',
    MEEZA = 'MEEZA',
    UNKNOWN = 'UNKNOWN',
}

@Entity('saved_cards')
@Index('idx_saved_cards_user_active', ['userId', 'deletedAt'])

@Unique('uq_user_provider_token', ['userId', 'providerCardToken'])
export class SavedCard {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    @Index('idx_saved_cards_user_id')
    userId: string;

    @Column({ type: 'varchar', length: 150 })
    cardHolderName: string;

    @Column({
        type: 'enum',
        enum: CardBrand,
        default: CardBrand.UNKNOWN,
    })
    cardBrand: CardBrand;

    @Column({ type: 'varchar', length: 4 })
    last4Digits: string;

    @Column({ type: 'smallint' })
    expiryMonth: number;

    @Column({ type: 'smallint' })
    expiryYear: number;

    @Column({ type: 'varchar', length: 255 })
    providerCardToken: string;

    @Column({ type: 'varchar', length: 50, default: 'PAYMOB' })
    providerName: string;

    @Column({ type: 'boolean', default: false })
    isDefault: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt?: Date | null;

    isExpired(): boolean {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        if (this.expiryYear < currentYear) {
            return true;
        }
        if (this.expiryYear === currentYear && this.expiryMonth < currentMonth) {
            return true;
        }
        return false;
    }
}