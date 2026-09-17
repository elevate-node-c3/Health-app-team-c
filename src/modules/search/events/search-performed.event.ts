export class SearchPerformedEvent {
    query: string;
    userId?: string;
    deviceId?: string;
    resultsCount: number;
    timestamp: Date;
    clientIp?: string;

    constructor(partial: Partial<SearchPerformedEvent>) {
        Object.assign(this, partial);
    }
}
