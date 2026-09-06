import * as bcrypt from 'bcrypt';

export class HashHelper {
    static async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return bcrypt.hash(password, saltRounds);
    }

    static async comparePasswords(plainPassword: string, hashedPass: string): Promise<boolean> {
        return bcrypt.compare(plainPassword, hashedPass);
    }
}