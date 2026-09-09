import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GuestSearchEntity } from "../entities/guest-search.entity";
import { UserSearchEntity } from "../entities/user-search.entity";
import { GuestPromotionEntity } from "../entities/guest-promotion.entity";

@Injectable()
export class PromoteGuestUseCase {
  private readonly logger = new Logger(PromoteGuestUseCase.name);

  constructor(
    @InjectRepository(GuestSearchEntity)
    private readonly guestSearchRepo: Repository<GuestSearchEntity>,
    @InjectRepository(UserSearchEntity)
    private readonly userSearchRepo: Repository<UserSearchEntity>,
    @InjectRepository(GuestPromotionEntity)
    private readonly promotionRepo: Repository<GuestPromotionEntity>,
  ) {}

  private normalize(query: string): string {
    return query.toLowerCase().trim();
  }

  async execute(params: {
    guestDeviceId: string;
    userId: string;
    bookingIntent?: Record<string, any> | null;
  }) {
    const { guestDeviceId, userId, bookingIntent } = params;

    if (!guestDeviceId) {
      return { migratedCount: 0, skipped: "NO_DEVICE_ID" as const };
    }

    const existingPromotion = await this.promotionRepo.findOne({
      where: { deviceId: guestDeviceId },
    });
    if (existingPromotion) {
      if (existingPromotion.userId !== userId) {
        this.logger.warn(
          `Guest device ${guestDeviceId} already promoted to user ${existingPromotion.userId}, skipping migration for ${userId}`,
        );
        return { migratedCount: 0, skipped: "GUEST_ALREADY_CLAIMED" as const };
      }
    } else {
      try {
        const promo = this.promotionRepo.create({
          deviceId: guestDeviceId,
          userId,
          bookingIntent: bookingIntent ?? null,
        });
        await this.promotionRepo.save(promo);
      } catch (err: any) {
        const isUniqueViolation =
          err?.code === "23505" || err?.message?.includes("duplicate");
        if (isUniqueViolation) {
          const winner = await this.promotionRepo.findOne({
            where: { deviceId: guestDeviceId },
          });

          if (winner && winner.userId !== userId) {
            this.logger.warn(
              `Race: device ${guestDeviceId} claimed by ${winner.userId} during promotion for ${userId}`,
            );
            return {
              migratedCount: 0,
              skipped: "GUEST_ALREADY_CLAIMED" as const,
            };
          }
        } else {
          throw err;
        }
      }
    }

    const guestSearches = await this.guestSearchRepo.find({
      where: { deviceId: guestDeviceId },
    });
    if (guestSearches.length === 0) {
      return { migratedCount: 0, skipped: null };
    }

    const existingUserSearches = await this.userSearchRepo.find({
      where: { userId },
    });
    const existingNormalized = new Set(
      existingUserSearches.map((r) => this.normalize(r.searchQuery)),
    );

    const toInsert: Partial<UserSearchEntity>[] = [];
    const seen = new Set<string>();

    for (const g of guestSearches) {
      const norm = this.normalize(g.searchQuery);
      if (existingNormalized.has(norm) || seen.has(norm)) continue;
      seen.add(norm);
      toInsert.push({
        userId,
        searchQuery: g.searchQuery,
      });
    }

    if (toInsert.length === 0) {
      return { migratedCount: 0, skipped: null };
    }

    let migratedCount = 0;
    for (const row of toInsert) {
      try {
        const entity = this.userSearchRepo.create(row);
        await this.userSearchRepo.save(entity);
        migratedCount++;
      } catch (err: any) {
        const isUniqueViolation =
          err?.code === "23505" ||
          err?.message?.includes("duplicate") ||
          err?.message?.includes("unique");
        if (!isUniqueViolation) {
          this.logger.error(
            `Failed to migrate search "${row.searchQuery}" for user ${userId}: ${err.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Migrated ${migratedCount}/${guestSearches.length} searches from device ${guestDeviceId} to user ${userId}`,
    );

    return { migratedCount, skipped: null };
  }
}
