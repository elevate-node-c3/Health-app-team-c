import * as Joi from 'joi';

export const validationSchema = Joi.object({
    // DEVELOPEMENT ENV
    NODE_ENV: Joi.string()
        .valid('development', 'test', 'staging', 'production')
        .default('development'),
    PORT: Joi.number().default(3000),
    API_PREFIX: Joi.string().default('api/v1'),

    // DATABASES ENV
    DB_HOST: Joi.string().required(),
    DB_PORT: Joi.number().default(5432),
    DB_USERNAME: Joi.string().required(),
    DB_PASSWORD: Joi.string().required(),
    DB_NAME: Joi.string().required(),
    DB_SYNC: Joi.boolean().default(false),
    DB_LOGGING: Joi.boolean().default(false),

    PRESCRIPTION_MAX_BYTES: Joi.number().default(5242880),
    PRESCRIPTION_STORAGE_PATH: Joi.string().default('./storage/prescriptions'),
    PRESCRIPTION_LINK_TTL_SECONDS: Joi.number().default(300),

    JWT_ACCESS_SECRET: Joi.string().required(),
    JWT_REFRESH_SECRET: Joi.string().required(),
});
