import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

@Entity('articles')
export class ArticleEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    @Column({ type: 'text' })
    summary: string;

    @Column({ type: 'text', nullable: true })
    content: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    imageUrl: string;

    @Index()
    @Column({ type: 'boolean', default: false })
    isPublished: boolean;

    @Index()
    @Column({ type: 'timestamp', nullable: true })
    publishedAt: Date;

    @Column({ type: 'varchar', length: 100, nullable: true })
    authorName: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}