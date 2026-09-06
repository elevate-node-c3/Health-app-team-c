import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    OneToMany
} from 'typeorm';
import { RefreshTokenEntity } from './refresh-token.entity';

export enum Gender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
}

export enum UserStatus {
    GUEST = 'GUEST',
    UNVERIFIED_PATIENT = 'UNVERIFIED_PATIENT',
    PATIENT = 'PATIENT',
    DOCTOR = 'DOCTOR',
    ADMIN = 'ADMIN',
}

@Entity('users')
export class UserEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'full_name', type: 'varchar', length: 150 })
    fullName: string;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 150, unique: true })
    email: string;

    @Index({ unique: true })
    @Column({ name: 'phone_number', type: 'varchar', length: 20, unique: true })
    phoneNumber: string;

    @Column({ type: 'enum', enum: Gender })
    gender: Gender;

    @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
    passwordHash: string;

    @Column({
        type: 'enum',
        enum: UserStatus,
        default: UserStatus.UNVERIFIED_PATIENT
    })
    status: UserStatus;


    @Column({ name: 'verification_code', type: 'varchar', length: 10, nullable: true })
    verificationCode: string | null;
    @Column({ name: 'code_expires_at', type: 'timestamp', nullable: true })
    code_expires_at: Date | null;

    @Column({ name: 'failed_attempts_count', type: 'int', default: 0 })
    failedAttemptsCount: number;

    @Column({ name: 'is_verified', type: 'boolean', default: false })
    isVerified: boolean;

    @OneToMany(() => RefreshTokenEntity, (refreshToken) => refreshToken.user)
    refreshTokens: RefreshTokenEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}