import { Injectable } from "@nestjs/common";
import { GetHomeDashboardUseCase } from "./use-case/get-home-dashboard.use-case";
import { AddFavoriteUseCase } from "./use-case/add-favorite.use-case";
import { RemoveFavoriteUseCase } from "./use-case/remove-favorite.use-case";
import { ListFavoritesUseCase } from "./use-case/list-favorites.use-case";
import { SearchMapUseCase } from "./use-case/search-map.use-case";
import { SearchMapDto } from "./dto/search-map.dto";
import {
  DoctorSort,
  ListFilteredDoctorsUseCase,
} from "./use-case/list-filtered-doctors.use-case";
import { FilterDoctorsDto } from "./dto/filter-doctors.dto";
import { GetDoctorProfileUseCase } from "./use-case/get-doctor-profile.use-case";
import { GetDoctorAvailabilityUseCase } from "./use-case/get-doctor-availability.use-case";

@Injectable()
export class CatalogService {
  constructor(
    private readonly getHomeDashboardUseCase: GetHomeDashboardUseCase,
    private readonly addFavoriteUseCase: AddFavoriteUseCase,
    private readonly removeFavoriteUseCase: RemoveFavoriteUseCase,
    private readonly listFavoritesUseCase: ListFavoritesUseCase,
    private readonly searchMapUseCase: SearchMapUseCase,
    private readonly listFilteredDoctorsUseCase: ListFilteredDoctorsUseCase,
    private readonly getDoctorProfileUseCase: GetDoctorProfileUseCase,
    private readonly getDoctorAvailabilityUseCase: GetDoctorAvailabilityUseCase,
  ) {}

  async getHomeDashboard(
    user?: { id: string; fullName: string },
    clientIp?: string,
  ) {
    return this.getHomeDashboardUseCase.execute(user, clientIp);
  }

  async addFavorite(userId: string, doctorId: string) {
    return this.addFavoriteUseCase.execute(userId, doctorId);
  }

  async removeFavorite(userId: string, doctorId: string) {
    return this.removeFavoriteUseCase.execute(userId, doctorId);
  }

  async listFavorites(userId: string) {
    return this.listFavoritesUseCase.execute(userId);
  }

  async searchMap(dto: SearchMapDto, userId?: string) {
    return this.searchMapUseCase.execute(dto, userId);
  }

  async listFilteredDoctors(
    filters: FilterDoctorsDto,
    opts?: {
      sort?: DoctorSort;
      page?: number;
      limit?: number;
      userId?: string;
    },
  ) {
    return this.listFilteredDoctorsUseCase.execute({ filters, ...opts });
  }

  async getDoctorProfile(doctorId: string, userId?: string) {
    return this.getDoctorProfileUseCase.execute({ doctorId, userId });
  }

  async getDoctorAvailability(doctorId: string, clinicId: string, date: string) {
    return this.getDoctorAvailabilityUseCase.execute({ doctorId, clinicId, date });
  }
}
