import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { DoctorEntity } from './entities/doctor.entity';
import { SpecialtyEntity } from './entities/specialty.entity';
import { OutboxEventEntity } from 'src/common/outbox/entities/outbox-event.entity';
import { GetHomeDashboardUseCase } from './use-case/get-home-dashboard.use-case';
import { DoctorClinicEntity } from './entities/doctor-clinic.entity';
import { ClinicEntity } from './entities/clinic.entity';
import { CatalogSeeder } from 'src/database/seeds/catalog.seed';
import { ArticleEntity } from './entities/article.entity';
import { FavoriteEntity } from './entities/favorite.entity';


@Module({
    imports: [
        TypeOrmModule.forFeature([
            DoctorEntity,
            SpecialtyEntity,
            DoctorClinicEntity,
            ClinicEntity,
            OutboxEventEntity,
            ArticleEntity,
            FavoriteEntity,
        ]),
    ],
    controllers: [CatalogController],
    providers: [CatalogService, CatalogSeeder, GetHomeDashboardUseCase],
    exports: [CatalogSeeder],
})
export class CatalogModule { }