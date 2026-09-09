import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from './user.entity';

@Entity('user_searches')
@Index(['userId', 'searchQuery'], { unique: true })
export class UserSearchEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ name: 'user_id', type: 'varchar' })
    userId: string;

    @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: UserEntity;

    @Column({ name: 'search_query', type: 'varchar', length: 255 })
    searchQuery: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
