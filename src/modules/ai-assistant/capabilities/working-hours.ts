export const WEEK_DAYS = [
    { token: 'Sun', en: 'Sunday', ar: 'الأحد' },
    { token: 'Mon', en: 'Monday', ar: 'الاثنين' },
    { token: 'Tue', en: 'Tuesday', ar: 'الثلاثاء' },
    { token: 'Wed', en: 'Wednesday', ar: 'الأربعاء' },
    { token: 'Thu', en: 'Thursday', ar: 'الخميس' },
    { token: 'Fri', en: 'Friday', ar: 'الجمعة' },
    { token: 'Sat', en: 'Saturday', ar: 'السبت' },
] as const;

export interface WorkingDay {
    day: string;
    dayAr: string;
    start: string;
    end: string;
}


export function parseWorkingHours(schedule: unknown): WorkingDay[] {
    if (!schedule || typeof schedule !== 'object') return [];
    const s = schedule as Record<string, unknown>;
    const result: WorkingDay[] = [];

    for (const d of WEEK_DAYS) {
        const v = s[d.token] as { start?: unknown; end?: unknown } | undefined;
        if (v && typeof v === 'object' && typeof v.start === 'string' && typeof v.end === 'string') {
            result.push({ day: d.en, dayAr: d.ar, start: v.start, end: v.end });
        }
    }

    if (!result.length && Array.isArray(s.days) && typeof s.hours === 'string') {
        const [start, end] = s.hours.split('-').map((x) => x.trim());
        if (start && end) {
            for (const d of WEEK_DAYS) {
                if ((s.days as unknown[]).includes(d.token)) {
                    result.push({ day: d.en, dayAr: d.ar, start, end });
                }
            }
        }
    }
    return result;
}

export function weekdayOf(date: string): { en: string; ar: string } {
    const index = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { en: WEEK_DAYS[index].en, ar: WEEK_DAYS[index].ar };
}