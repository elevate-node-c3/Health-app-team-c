export class ResultListViewedEvent {
    query?: string;
    specialtyId?: string;
    userId?: string;
    deviceId?: string;
    resultsCount: number;
    timestamp: Date;
    clientIp?: string;
    sortOption?: string;

    constructor(partial: Partial<ResultListViewedEvent>) {
        Object.assign(this, partial);
    }
}
