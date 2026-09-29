import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxProcessorService } from './services/outbox-processor.service';
import { AlertService } from './services/alert.service';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([OutboxEventEntity]),
    ],
    providers: [
        OutboxProcessorService,
        AlertService,
    ],
    exports: [
        OutboxProcessorService,
        AlertService,
    ],
})
export class OutboxModule { }