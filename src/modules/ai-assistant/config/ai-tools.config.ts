import { AI_POLICY_TOPICS } from './ai-policies.config';

export const TOOL = {
    LIST_SPECIALTIES: 'list_specialties',
    SEARCH_DOCTORS: 'search_doctors',
    GET_AVAILABILITY: 'get_availability',
    GET_MY_APPOINTMENTS: 'get_my_appointments',
    GET_POLICY: 'get_policy',
    SUGGEST_SPECIALTY: 'suggest_specialty',
} as const;

const PERSONAL_TOOLS: ReadonlySet<string> = new Set([TOOL.GET_MY_APPOINTMENTS]);

const ALL_TOOLS = [
    {
        type: 'function',
        function: {
            name: TOOL.LIST_SPECIALTIES,
            description:
                'List the medical specialties that have doctors in the system. Call this when you are not sure of the exact specialty name to use in the other tools.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL.SUGGEST_SPECIALTY,
            description:
                'Offer the patient a ready-made doctor search for a specialty. Call it once, when you have identified which specialty treats the problem. The specialty must be exactly one of the values returned by list_specialties.',
            parameters: {
                type: 'object',
                properties: {
                    specialty: {
                        type: 'string',
                        description: 'Exact specialty name as returned by list_specialties',
                    },
                },
                required: ['specialty'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL.SEARCH_DOCTORS,
            description:
                'Search active doctors by specialty and/or name. The specialty must be exactly a value from list_specialties. Never mention a doctor who was not returned by this tool.',
            parameters: {
                type: 'object',
                properties: {
                    specialty: { type: 'string', description: 'Exact specialty name from list_specialties' },
                    name: {
                        type: 'string',
                        description:
                            'Doctor name EXACTLY as the patient wrote it. Never translate or transliterate it, and keep any number in it (names are stored as written, often in English with a number).',
                    },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL.GET_AVAILABILITY,
            description:
                "Get a doctor's clinics, consultation fees, weekly working hours and free time slots. Use the doctor id returned by search_doctors (never guess an id). Copy clinic names, weekday names, dates and times exactly as returned; never state a time or day that this tool did not return.",
            parameters: {
                type: 'object',
                properties: {
                    doctorId: { type: 'string', description: 'Doctor id (UUID) from search_doctors' },
                },
                required: ['doctorId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL.GET_MY_APPOINTMENTS,
            description:
                "Get the signed-in patient's own appointments. Takes no parameters: the patient is identified by the session, never by an argument. Do not pass or ask for any user id.",
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: TOOL.GET_POLICY,
            description: 'Get the official clinic policy text for a topic. Never state policy details that this tool did not return.',
            parameters: {
                type: 'object',
                properties: {
                    topic: { type: 'string', enum: [...AI_POLICY_TOPICS], description: 'Policy topic' },
                },
                required: ['topic'],
                additionalProperties: false,
            },
        },
    },
];

export function buildToolDefinitions(options: { isGuest: boolean }) {
    return ALL_TOOLS.filter((t) => !(options.isGuest && PERSONAL_TOOLS.has(t.function.name)));
}