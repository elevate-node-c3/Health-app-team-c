export function generateOtpCode(length: number = 4): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

export function getOtpExpirationTime(minutes: number = 3): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
}