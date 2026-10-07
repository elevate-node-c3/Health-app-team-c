import * as Joi from 'joi';

export const SearchDoctorsSchema = Joi.object({
    specialtyId: Joi.string().uuid().optional().messages({
        'string.guid': 'specialtyId must be a valid UUID',
    }),
    specialtyName: Joi.string().optional(),
    name: Joi.string().optional(),
    city: Joi.string().optional(),
    nearMe: Joi.boolean().optional(),
    availableSoon: Joi.boolean().optional(),
});

export const GetAvailabilitySchema = Joi.object({
    doctorId: Joi.string().uuid().required().messages({
        'string.guid': 'doctorId must be a valid UUID',
        'any.required': 'doctorId is required',
    }),
    startDate: Joi.string().isoDate().optional().messages({
        'string.isoDate': 'startDate must be in YYYY-MM-DD format',
    }),
    endDate: Joi.string().isoDate().optional().messages({
        'string.isoDate': 'endDate must be in YYYY-MM-DD format',
    }),
});

export const SuggestSpecialtySchema = Joi.object({
    symptoms: Joi.string().min(3).required().messages({
        'string.min': 'symptoms must be at least 3 characters long',
        'any.required': 'symptoms field is required',
    }),
});

export interface SearchDoctorsDto {
    specialtyId?: string;
    specialtyName?: string;
    name?: string;
    city?: string;
    nearMe?: boolean;
    availableSoon?: boolean;
}

export interface GetAvailabilityDto {
    doctorId: string;
    startDate?: string;
    endDate?: string;
}

export interface SuggestSpecialtyDto {
    symptoms: string;
}