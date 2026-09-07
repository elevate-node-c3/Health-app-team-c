import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxProcessorService } from './services/outbox-processor.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([OutboxEventEntity]),
    ],
    providers: [
        OutboxProcessorService,
    ],
    exports: [
        TypeOrmModule,
    ],
})
export class OutboxModule { }