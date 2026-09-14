import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpecialtyEntity } from '../../modules/catalog/entities/specialty.entity';
import { ClinicEntity, PlaceType } from '../../modules/catalog/entities/clinic.entity';
import { DoctorEntity, DoctorTitle } from '../../modules/catalog/entities/doctor.entity';
import { DoctorClinicEntity } from '../../modules/catalog/entities/doctor-clinic.entity';
import { RedisService } from 'src/common/redis/redis.service';
import { CACHE_KEYS } from 'src/common/constants/cache-keys.constant';

@Injectable()
export class CatalogSeeder {
    private readonly logger = new Logger(CatalogSeeder.name);

    constructor(
        @InjectRepository(SpecialtyEntity)
        private readonly specialtyRepo: Repository<SpecialtyEntity>,
        @InjectRepository(ClinicEntity)
        private readonly clinicRepo: Repository<ClinicEntity>,
        @InjectRepository(DoctorEntity)
        private readonly doctorRepo: Repository<DoctorEntity>,
        @InjectRepository(DoctorClinicEntity)
        private readonly doctorClinicRepo: Repository<DoctorClinicEntity>,
        private readonly redisService: RedisService,
    ) { }

    async seed() {
        this.logger.log('Starting Catalog Seeding...');

        const specialtyNames = [
            'Cardiology',
            'Dermatology',
            'Pediatrics',
            'Orthopedics',
            'Dentistry',
            'Ophthalmology',
            'Neurology',
            'Internal Medicine',
        ];

        const specialties: SpecialtyEntity[] = [];
        for (const name of specialtyNames) {
            let specialty = await this.specialtyRepo.findOne({ where: { name } });
            if (!specialty) {
                specialty = this.specialtyRepo.create({ name, description: `${name} specialty department` });
                specialty = await this.specialtyRepo.save(specialty);
                this.logger.log(`Created specialty: ${name}`);
            }
            specialties.push(specialty);
        }
        this.logger.log(`Seeded ${specialties.length} specialties successfully.`);

        const clinicData = [
            { name: 'Cairo Care Clinic', placeType: PlaceType.CLINIC, governorate: 'Cairo', city: 'Nasr City', address: '12 Street 9' },
            { name: 'El Salam Hospital', placeType: PlaceType.HOSPITAL, governorate: 'Cairo', city: 'Maadi', address: 'Corniche El Nile' },
            { name: 'Giza Medical Centre', placeType: PlaceType.CENTRE, governorate: 'Giza', city: 'Dokki', address: 'Mohy El Din Abou El Ezz' },
            { name: 'Alexandria Health Hub', placeType: PlaceType.CLINIC, governorate: 'Alexandria', city: 'Smouha', address: 'Fouad Street' },
        ];

        const clinics: ClinicEntity[] = [];
        for (const data of clinicData) {
            let clinic = await this.clinicRepo.findOne({ where: { name: data.name } });
            if (!clinic) {
                clinic = this.clinicRepo.create(data);
                clinic = await this.clinicRepo.save(clinic);
                this.logger.log(`Created clinic: ${data.name}`);
            }
            clinics.push(clinic);
        }
        this.logger.log(`Seeded ${clinics.length} clinics successfully.`);

        const titles = [DoctorTitle.PROFESSOR, DoctorTitle.CONSULTANT, DoctorTitle.SPECIALIST];
        const targetDoctorCount = 50;

        const firstNames = ['Ahmed', 'Mohamed', 'Mahmoud', 'Khaled', 'Tarek', 'Amr', 'Youssef', 'Hassan', 'Ibrahim', 'Mostafa'];
        const lastNames = ['El-Sayed', 'El-Khatib', 'Salem', 'Farouk', 'Nour', 'Zaky', 'Mansour', 'Barakat', 'Kassem', 'Radwan'];
        const universities = ['Cairo University', 'Ain Shams University', 'Alexandria University', 'Mansoura University'];

        let seededDoctorsCount = 0;

        for (let i = 1; i <= targetDoctorCount; i++) {
            const randomFirst = firstNames[Math.floor(Math.random() * firstNames.length)];
            const randomLast = lastNames[Math.floor(Math.random() * lastNames.length)];
            const fullName = `Dr. ${randomFirst} ${randomLast} ${i}`;

            let doctor = await this.doctorRepo.findOne({ where: { fullName } });

            if (!doctor) {
                const randomSpecialty = specialties[Math.floor(Math.random() * specialties.length)];
                const randomTitle = titles[Math.floor(Math.random() * titles.length)];
                const randomUniv = universities[Math.floor(Math.random() * universities.length)];

                doctor = this.doctorRepo.create({
                    fullName,
                    title: randomTitle,
                    university: randomUniv,
                    subspecialties: [randomSpecialty.name + ' Sub-1', randomSpecialty.name + ' Sub-2'],
                    experienceYears: Math.floor(Math.random() * 20) + 3,
                    averageRating: Number((Math.random() * 2 + 3).toFixed(2)),
                    totalReviews: Math.floor(Math.random() * 150) + 5,
                    isVerified: true,
                    specialtyId: randomSpecialty.id,
                });

                doctor = await this.doctorRepo.save(doctor);
            }

            const primaryClinic = clinics[(i - 1) % clinics.length];
            const primaryFee = Math.floor(Math.random() * 600) + 200;

            const existingPair = await this.doctorClinicRepo.findOne({
                where: { doctorId: doctor.id, clinicId: primaryClinic.id },
            });

            if (!existingPair) {
                await this.doctorClinicRepo.save({
                    doctorId: doctor.id,
                    clinicId: primaryClinic.id,
                    consultationFee: primaryFee,
                    schedule: { days: ['Sun', 'Tue', 'Thu'], hours: '10:00 - 15:00' },
                    isActive: true,
                });
            }

            if (i <= 15) {
                const secondaryClinic = clinics[i % clinics.length];
                if (secondaryClinic.id !== primaryClinic.id) {
                    const secondaryFee = Math.floor(Math.random() * 800) + 700;

                    const existingSecondPair = await this.doctorClinicRepo.findOne({
                        where: { doctorId: doctor.id, clinicId: secondaryClinic.id },
                    });

                    if (!existingSecondPair) {
                        await this.doctorClinicRepo.save({
                            doctorId: doctor.id,
                            clinicId: secondaryClinic.id,
                            consultationFee: secondaryFee,
                            schedule: { days: ['Mon', 'Wed'], hours: '17:00 - 21:00' },
                            isActive: true,
                        });
                    }
                }
            }

            seededDoctorsCount++;
        }

        this.logger.log(`Successfully verified and seeded ${seededDoctorsCount} doctors with multi-clinic pairings!`);
        this.logger.log('Catalog Seeding Completed Successfully.');

        const cacheKey = CACHE_KEYS.CATALOG_HOME_PUBLIC_DATA;
        await this.redisService.del(cacheKey);
        this.logger.log('Cache evicted successfully after seeding!');
    }
}