import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SearchPerformedEvent } from '../events/search-performed.event';

@Injectable()
export class SearchAnalyticsListener {
    private readonly logger = new Logger(SearchAnalyticsListener.name);

    @OnEvent('search.performed')
    handleSearchAnalytics(event: SearchPerformedEvent) {
        this.logger.log(
            `[SEARCH_ANALYTICS] Query="${event.query}" ResultsCount=${event.resultsCount} User=${event.userId || 'GUEST'} Device=${event.deviceId || 'N/A'} IP=${event.clientIp || 'N/A'}`,
        );
    }
}
