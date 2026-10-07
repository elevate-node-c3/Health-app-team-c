import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TypeOrmCatalogGateway } from './typeorm-catalog.gateway';
import { DoctorEntity } from 'src/modules/catalog/entities/doctor.entity';
import { AppointmentEntity } from 'src/modules/catalog/entities/appointment.entity';
import { DoctorClinicEntity } from 'src/modules/catalog/entities/doctor-clinic.entity';

describe('TypeOrmCatalogGateway', () => {
    let gateway: TypeOrmCatalogGateway;
    let doctorRepo: jest.Mocked<Repository<DoctorEntity>>;
    let appointmentRepo: jest.Mocked<Repository<AppointmentEntity>>;
    let doctorClinicRepo: jest.Mocked<Repository<DoctorClinicEntity>>;
    let doctorQueryBuilder: jest.Mocked<SelectQueryBuilder<DoctorEntity>>;

    beforeEach(async () => {
        doctorQueryBuilder = {
            innerJoin: jest.fn().mockReturnThis(),
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            addOrderBy: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            getRawMany: jest.fn(),
            getManyAndCount: jest.fn(),
        } as unknown as jest.Mocked<SelectQueryBuilder<DoctorEntity>>;

        doctorRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(doctorQueryBuilder),
            findOne: jest.fn(),
            metadata: {
                findRelationWithPropertyPath: jest.fn().mockReturnValue({
                    inverseEntityMetadata: { target: 'SpecialtyEntity' },
                }),
            },
            manager: {
                getRepository: jest.fn(),
            },
        } as unknown as jest.Mocked<Repository<DoctorEntity>>;

        appointmentRepo = {
            find: jest.fn(),
        } as unknown as jest.Mocked<Repository<AppointmentEntity>>;

        doctorClinicRepo = {
            find: jest.fn(),
        } as unknown as jest.Mocked<Repository<DoctorClinicEntity>>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TypeOrmCatalogGateway,
                { provide: getRepositoryToken(DoctorEntity), useValue: doctorRepo },
                { provide: getRepositoryToken(AppointmentEntity), useValue: appointmentRepo },
                { provide: getRepositoryToken(DoctorClinicEntity), useValue: doctorClinicRepo },
            ],
        }).compile();

        gateway = module.get<TypeOrmCatalogGateway>(TypeOrmCatalogGateway);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('listSpecialties', () => {
        it('should aggregate doctor counts, map aliases, and sort specialties alphabetically', async () => {
            const mockSpecialtyRepo = {
                find: jest.fn().mockResolvedValue([
                    { id: 2, name: 'Dermatology', nameAr: 'جلدية' },
                    { id: 1, name: 'Cardiology', titleEn: 'Heart', nameAr: 'قلب' },
                    { id: 3, name: 'Neurology' }, // zero active doctors
                ]),
            };
            (doctorRepo.manager.getRepository as jest.Mock).mockReturnValue(mockSpecialtyRepo);

            doctorQueryBuilder.getRawMany.mockResolvedValueOnce([
                { id: '1', count: '5' },
                { id: '2', count: '3' },
            ]);

            const result = await gateway.listSpecialties();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                id: '1',
                name: 'Cardiology',
                aliases: ['قلب', 'Heart'],
                doctorCount: 5,
            });
            expect(result[1]).toEqual({
                id: '2',
                name: 'Dermatology',
                aliases: ['جلدية'],
                doctorCount: 3,
            });
        });

        it('should throw an error if specialty relation metadata is missing', async () => {
            (doctorRepo.metadata.findRelationWithPropertyPath as jest.Mock).mockReturnValueOnce(null);

            await expect(gateway.listSpecialties()).rejects.toThrow(
                'DoctorEntity.specialty is not a relation',
            );
        });
    });

    describe('searchDoctors', () => {
        it('should filter by specialtyId and all tokenized name parts using ILIKE', async () => {
            const mockDoctors = [
                { id: 'doc-1', fullName: 'Dr. Johnathan Doe', specialty: { name: 'Cardiology' } },
            ];
            doctorQueryBuilder.getManyAndCount.mockResolvedValueOnce([mockDoctors as any, 1]);

            const result = await gateway.searchDoctors({
                specialtyId: 'spec-1',
                name: 'Dr. John Doe',
                limit: 5,
            });

            expect(doctorQueryBuilder.andWhere).toHaveBeenCalledWith('s.id = :specialtyId', {
                specialtyId: 'spec-1',
            });
            expect(doctorQueryBuilder.andWhere).toHaveBeenCalledWith(
                'd.fullName ILIKE :nameToken0',
                expect.objectContaining({ nameToken0: '%John%' }),
            );
            expect(doctorQueryBuilder.andWhere).toHaveBeenCalledWith(
                'd.fullName ILIKE :nameToken1',
                expect.objectContaining({ nameToken1: '%Doe%' }),
            );
            expect(doctorQueryBuilder.take).toHaveBeenCalledWith(5);
            expect(result).toEqual({
                doctors: [{ id: 'doc-1', name: 'Dr. Johnathan Doe', specialty: 'Cardiology' }],
                total: 1,
            });
        });
    });

    describe('getDoctor', () => {
        it('should return doctor summary with resolved specialty label when found and active', async () => {
            doctorRepo.findOne.mockResolvedValueOnce({
                id: 'doc-1',
                fullName: 'Dr. Sarah Connor',
                specialty: { titleAr: 'قلب', name: 'Cardiology' },
            } as any);

            const result = await gateway.getDoctor('doc-1');

            expect(doctorRepo.findOne).toHaveBeenCalledWith({
                where: { id: 'doc-1', isActive: true, isVerified: true },
                relations: { specialty: true },
            });
            expect(result).toEqual({
                id: 'doc-1',
                name: 'Dr. Sarah Connor',
                specialty: 'Cardiology',
            });
        });

        it('should return null when doctor does not exist', async () => {
            doctorRepo.findOne.mockResolvedValueOnce(null);

            const result = await gateway.getDoctor('doc-404');

            expect(result).toBeNull();
        });
    });

    describe('getDoctorClinics', () => {
        it('should filter out inactive clinics and map clinic details with parsed working hours', async () => {
            const mockDoctorClinics = [
                {
                    clinicId: 'clinic-active',
                    consultationFee: 250,
                    schedule: null,
                    clinic: { name: 'Main Care', isActive: true },
                },
                {
                    clinicId: 'clinic-inactive',
                    consultationFee: 150,
                    schedule: null,
                    clinic: { name: 'Old Branch', isActive: false },
                },
            ];
            doctorClinicRepo.find.mockResolvedValueOnce(mockDoctorClinics as any);

            const result = await gateway.getDoctorClinics('doc-1');

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                clinicId: 'clinic-active',
                clinicName: 'Main Care',
                consultationFee: 250,
                workingHours: [],
            });
        });
    });

    describe('getAppointments', () => {
        it('should sort upcoming appointments chronologically before past ones and detect available dates', async () => {
            const futureDate = new Date(Date.now() + 86_400_000);
            const pastDate = new Date(Date.now() - 86_400_000);

            const mockAppointments = [
                {
                    status: 'COMPLETED',
                    startsAt: pastDate.toISOString(),
                    doctor: { fullName: 'Dr. Past', specialty: { name: 'Pediatrics' } },
                    clinic: { name: 'Past Clinic' },
                },
                {
                    status: 'CONFIRMED',
                    scheduledAt: futureDate.toISOString(),
                    doctor: { fullName: 'Dr. Future', specialty: { name: 'Dentistry' } },
                    clinic: { name: 'Future Clinic' },
                },
            ];

            appointmentRepo.find.mockResolvedValueOnce(mockAppointments as any);

            const result = await gateway.getAppointments('patient-1', 5);

            expect(result.datesAvailable).toBe(true);
            expect(result.appointments).toHaveLength(2);
            expect(result.appointments[0].doctorName).toBe('Dr. Future');
            expect(result.appointments[0].startsAt).toBe(futureDate.toISOString());
            expect(result.appointments[1].doctorName).toBe('Dr. Past');
        });

        it('should flag datesAvailable as false when appointments exist but contain no parseable start dates', async () => {
            const mockAppointments = [
                {
                    status: 'PENDING',
                    doctor: { fullName: 'Dr. Unknown' },
                    clinic: null,
                },
            ];

            appointmentRepo.find.mockResolvedValueOnce(mockAppointments as any);

            const result = await gateway.getAppointments('patient-1', 2);

            expect(result.datesAvailable).toBe(false);
            expect(result.appointments[0].startsAt).toBeNull();
        });
    });
});