export function normalizeEgyptianPhoneNumber(phone: string): string {
    let clean = phone.trim();
    if (clean.startsWith('0')) {
        clean = '+20' + clean.slice(1);
    }
    return clean;
}

export function maskPhoneNumber(phone: string): string {
    if (phone.length < 4) return '****';
    return phone.slice(0, 3) + '*****' + phone.slice(-3);
}