import { SetMetadata } from '@nestjs/common';

export const CACHE_KEYS_METADATA = 'CACHE_KEYS_METADATA';

export const EvictCache = (...keys: string[]) => SetMetadata(CACHE_KEYS_METADATA, keys);