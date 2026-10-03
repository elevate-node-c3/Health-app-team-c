import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRescheduleColumns1790985600000 implements MigrationInterface {
  name = 'AddRescheduleColumns1790985600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "rescheduleCount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "rescheduledAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "rescheduledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "rescheduleCount"`,
    );
  }
}
