🩺 DOCURA Catalog Module - Cache Eviction Strategy Guide
1. 🔍 The Problem: Stale Cache on Data Mutations
[ Admin Updates Data / Seeder Runs ] ➡️ [ DB Changes ] ❌ [ Redis Stale Cache ] ➡️ [ User Sees Old Data ]

2. ⚡ The Solution: Cache Eviction AOP Pattern
[ Write / Mutation Request ] ➡️ [ Controller Method ] ➡️ [ CacheEvictionInterceptor ] ➡️ [ Redis DEL Command ] ➡️ [ Fresh Data on Next Request ]

3. 🛠️ Implementation Components
Decorator (evict-cache.decorator.ts): Located in src/common/decorators/, used to declare which cache keys need to be invalidated.

Interceptor (cache-eviction.interceptor.ts): Located in src/common/interceptors/, intercepts successful execution and triggers the deletion of specified keys from Redis.

4. 📝 Usage Guide for Developers
When implementing any new endpoint that modifies data affecting the home dashboard (e.g., adding a doctor, updating specialties, or publishing articles), use the custom @EvictCache decorator alongside the interceptor on the controller method:

TypeScript
import { Controller, Post, Body, UseInterceptors } from '@nestjs/common';
import { CacheEvictionInterceptor } from '../../common/interceptors/cache-eviction.interceptor';
import { EvictCache } from '../../common/decorators/evict-cache.decorator';

@Controller('catalog')
export class CatalogController {

    @Post('doctor')
    @UseInterceptors(CacheEvictionInterceptor) // Triggers eviction handling automatically on success
    @EvictCache('catalog:home:public_data')    // Specifies the exact cache key to clear
    async createDoctor(@Body() dto: CreateDoctorDto) {
        return await this.createDoctorUseCase.execute(dto);
    }
}
5. 💡 Best Practices & Rules
Scope of Application: Apply @EvictCache exclusively to state-changing operations (POST, PUT, PATCH, DELETE) that impact public catalog data.

Separation of Concerns: Keep Redis deletion logic decoupled from the core business logic (Use Cases) by leveraging the AOP Interceptor pattern.