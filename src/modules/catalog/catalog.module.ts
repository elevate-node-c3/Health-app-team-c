import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { DoctorEntity } from "./entities/doctor.entity";
import { SpecialtyEntity } from "./entities/specialty.entity";
import { OutboxEventEntity } from "src/common/outbox/entities/outbox-event.entity";
import { ProcessedEventEntity } from "src/common/outbox/entities/processed-event.entity";
import { OutboxProcessorService } from "src/common/outbox/services/outbox-processor.service";
import { GetHomeDashboardUseCase } from "./use-case/get-home-dashboard.use-case";
import { AddFavoriteUseCase } from "./use-case/add-favorite.use-case";
import { RemoveFavoriteUseCase } from "./use-case/remove-favorite.use-case";
import { ListFavoritesUseCase } from "./use-case/list-favorites.use-case";
import { SearchMapUseCase } from "./use-case/search-map.use-case";
import { ListFilteredDoctorsUseCase } from "./use-case/list-filtered-doctors.use-case";
import { DoctorClinicEntity } from "./entities/doctor-clinic.entity";
import { ClinicEntity } from "./entities/clinic.entity";
import { CatalogSeeder } from "src/database/seeds/catalog.seed";
import { ArticleEntity } from "./entities/article.entity";
import { FavoriteEntity } from "./entities/favorite.entity";
import { NotificationEntity } from "./entities/notification.entity";
import { ReviewEntity } from "./entities/review.entity";
import { AppointmentEntity } from "./entities/appointment.entity";
import { FavoriteNotificationConsumer } from "./consumers/favorite-notification.consumer";
import { GetDoctorProfileUseCase } from "./use-case/get-doctor-profile.use-case";
import { GetDoctorAvailabilityUseCase } from "./use-case/get-doctor-availability.use-case";
import { SlotHoldEntity } from "../booking/entities/slot-hold.entity";

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
      ReviewEntity,
      AppointmentEntity,
      SlotHoldEntity,
    ]),
  ],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogSeeder,
    GetHomeDashboardUseCase,
    AddFavoriteUseCase,
    RemoveFavoriteUseCase,
    ListFavoritesUseCase,
    SearchMapUseCase,
    FavoriteNotificationConsumer,
    OutboxProcessorService,
    ListFilteredDoctorsUseCase,
    GetDoctorProfileUseCase,
    GetDoctorAvailabilityUseCase,
  ],
  exports: [CatalogSeeder],
})
export class CatalogModule {}
