import { describe, it, expect } from 'vitest';
import { Parser, RoundParser, Event } from '../src/parser.js';
import EventType from '../src/eventType.js';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, '.');

/**
 * Summarize events into a distribution map of EventType -> count.
 */
function eventDistribution(events: Event[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const ev of events) {
        const name = EventType[ev.eventType];
        dist[name] = (dist[name] || 0) + 1;
    }
    return dist;
}

describe('Event parsing - L0308008 (schtop round 1)', () => {
    let events: Event[];
    let parsingErrors: string[] | undefined;

    // Use a shared parser instance for all tests in this describe block
    const setup = (async () => {
        const parser = new Parser(resolve(fixtureDir, 'L0308008.log'));
        const result = await parser.parseRounds(true);
        events = result.rawStats.events[0];
        parsingErrors = result.parsing_errors[0];
    })();

    it('produces events', async () => {
        await setup;
        expect(events.length).toBeGreaterThan(0);
    });

    it('has correct event type distribution', async () => {
        await setup;
        const dist = eventDistribution(events);
        expect(dist).toMatchSnapshot();
    });

    it('has no or minimal parsing errors', async () => {
        await setup;
        expect(parsingErrors).toMatchSnapshot();
    });

    it('starts with MapLoading for schtop', async () => {
        await setup;
        const mapEvent = events.find(e => e.eventType === EventType.MapLoading);
        expect(mapEvent).toBeDefined();
        expect(mapEvent!.data?.value).toBe('schtop');
    });

    it('has TeamScore events', async () => {
        await setup;
        const scoreEvents = events.filter(e => e.eventType === EventType.TeamScore);
        expect(scoreEvents.length).toBeGreaterThan(0);
        // Snapshot the score event data
        const scoreData = scoreEvents.map(e => ({
            data: e.data,
            rawLine: e.rawLine,
        }));
        expect(scoreData).toMatchSnapshot();
    });

    it('has player join and role events', async () => {
        await setup;
        const joinEvents = events.filter(e =>
            e.eventType === EventType.PlayerJoinTeam ||
            e.eventType === EventType.PlayerChangeRole
        );
        expect(joinEvents.length).toBeGreaterThan(0);

        // Snapshot summarized join/role data
        const summary = joinEvents.map(e => ({
            type: EventType[e.eventType],
            player: e.playerFrom?.name || e.playerTo?.name,
            data: e.data,
        }));
        expect(summary).toMatchSnapshot();
    });
});

describe('Event parsing - L0308009 (schtop round 2)', () => {
    it('has correct event type distribution', async () => {
        const parser = new Parser(resolve(fixtureDir, 'L0308009.log'));
        const result = await parser.parseRounds(true);
        const events = result.rawStats.events[0];
        const dist = eventDistribution(events);
        expect(dist).toMatchSnapshot();
    });
});
