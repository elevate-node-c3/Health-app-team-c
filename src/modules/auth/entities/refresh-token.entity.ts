import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('refresh_tokens')
export class RefreshTokenEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;


    @Column()
    userId: string;

    @Column()
    tokenHash: string;

    @ManyToOne(() => UserEntity, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: UserEntity;

    @Column()
    expiresAt: Date;

    @CreateDateColumn()
    createdAt: Date;
}