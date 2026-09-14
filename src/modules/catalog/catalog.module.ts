import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { DoctorEntity } from './entities/doctor.entity';
import { SpecialtyEntity } from './entities/specialty.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { ProcessedEventEntity } from 'src/common/outbox/entities/processed-event.entity';
import { OutboxProcessorService } from 'src/common/outbox/services/outbox-processor.service';
import { GetHomeDashboardUseCase } from './use-case/get-home-dashboard.use-case';
import { AddFavoriteUseCase } from './use-case/add-favorite.use-case';
import { DoctorClinicEntity } from './entities/doctor-clinic.entity';
import { ClinicEntity } from './entities/clinic.entity';
import { CatalogSeeder } from 'src/database/seeds/catalog.seed';
import { ArticleEntity } from './entities/article.entity';
import { FavoriteEntity } from './entities/favorite.entity';
import { NotificationEntity } from './entities/notification.entity';


@Module({
    imports: [
        TypeOrmModule.forFeature([
            DoctorEntity,
            SpecialtyEntity,
            DoctorClinicEntity,
            ClinicEntity,
            OutboxEventEntity,
            ProcessedEventEntity,
            ArticleEntity,
            FavoriteEntity,
            NotificationEntity,
        ]),
    ],
    controllers: [CatalogController],
    providers: [CatalogService, CatalogSeeder, GetHomeDashboardUseCase, AddFavoriteUseCase, OutboxProcessorService],
    exports: [CatalogSeeder],
})
export class CatalogModule { }