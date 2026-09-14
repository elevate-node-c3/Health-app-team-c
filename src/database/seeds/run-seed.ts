import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { CatalogSeeder } from './catalog.seed';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);

    const catalogSeeder = app.get(CatalogSeeder);

    try {
        await catalogSeeder.seed();
        console.log('Database seeding completed successfully!');
    } catch (error) {
        console.error('Error during database seeding:', error);
    } finally {
        await app.close();
    }
}

bootstrap();