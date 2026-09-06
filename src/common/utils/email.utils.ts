export function maskEmail(email: string): string {
    if (!email || !email.includes('@')) return email;

    const [localPart, domain] = email.split('@');

    if (localPart.length <= 2) {
        return `${localPart[0]}*@${domain}`;
    }

    const firstTwo = localPart.slice(0, 2);
    const lastChar = localPart.slice(-1);
    const maskedMiddle = '*'.repeat(localPart.length - 3);

    return `${firstTwo}${maskedMiddle}${lastChar}@${domain}`;
}