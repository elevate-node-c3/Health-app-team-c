import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    Index,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('refresh_tokens')
export class RefreshTokenEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Groups all rotations that originated from a single login into one revocable chain. */
    @Index()
    @Column({ name: 'family_id', type: 'uuid' })
    familyId: string;

    @Index()
    @Column({ name: 'user_id' })
    userId: string;

    /** SHA-256 hash of the raw refresh token — the raw token is never persisted. */
    @Index({ unique: true })
    @Column({ name: 'token_hash' })
    tokenHash: string;

    /**
     * Hash of the token that replaced this one during rotation.
     * NULL means this is the current live token in the family.
     * Non-NULL means this token has already been rotated out.
     */
    @Column({ name: 'replaced_by_token_hash', type: 'varchar', nullable: true })
    replacedByTokenHash: string | null;

    /**
     * Set when the token (or its whole family) is explicitly revoked.
     * Used for sign-out and theft-detection invalidation.
     */
    @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
    revokedAt: Date | null;

    /** Optional human-readable device hint stored at token-issue time. */
    @Column({ name: 'device_label', type: 'varchar', length: 200, nullable: true })
    deviceLabel: string | null;

    @ManyToOne(() => UserEntity, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'expires_at' })
    expiresAt: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}