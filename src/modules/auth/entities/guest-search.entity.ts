import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('guest_searches')
@Index(['deviceId', 'searchQuery'], { unique: true })
export class GuestSearchEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ name: 'device_id', type: 'varchar', length: 100 })
    deviceId: string;

    @Column({ name: 'search_query', type: 'varchar', length: 255 })
    searchQuery: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}