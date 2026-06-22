import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parsing/match-parser.js';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, '.');

/**
 * Strip circular references (Event[] inside GenericStat, Player refs) for snapshot.
 */
function sanitizeForSnapshot(obj: unknown): unknown {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        if (key === 'events' && Array.isArray(value)) return undefined;
        if (key === 'playerFrom' || key === 'playerTo') return undefined;
        return value;
    }));
}

describe('Output stats - 2-round schtop match', () => {
    let result: Awaited<ReturnType<Parser['parseRounds']>>;

    const setup = (async () => {
        const parser = new Parser(
            resolve(fixtureDir, 'L0308008.log'),
            resolve(fixtureDir, 'L0308009.log'),
        );
        result = await parser.parseRounds(true);
    })();

    it('has correct map and server metadata', async () => {
        await setup;
        const round1 = result.stats[0]!;
        expect(round1.map).toMatchSnapshot();
        expect(round1.server).toMatchSnapshot();
        expect(round1.date).toMatchSnapshot();
        expect(round1.game_time).toMatchSnapshot();
    });

    it('has correct team scores per round', async () => {
        await setup;
        const scores = result.stats.map(s => s?.score);
        expect(scores).toMatchSnapshot();
    });

    it('has correct team composition', async () => {
        await setup;
        expect(result.players).toMatchSnapshot();
    });

    it('has scoring activity with flag movements', async () => {
        await setup;
        const activities = result.stats.map(s => s?.scoring_activity);
        expect(sanitizeForSnapshot(activities)).toMatchSnapshot();
    });

    it('has team stats comparison', async () => {
        await setup;
        expect(result.comparison).toMatchSnapshot();
    });
});

describe('Player stats - schtop match', () => {
    let result: Awaited<ReturnType<Parser['parseRounds']>>;

    const setup = (async () => {
        const parser = new Parser(
            resolve(fixtureDir, 'L0308008.log'),
            resolve(fixtureDir, 'L0308009.log'),
        );
        result = await parser.parseRounds(true);
    })();

    it('per-player stats for round 1', async () => {
        await setup;
        const round1Teams = result.stats[0]!.teams;
        expect(sanitizeForSnapshot(round1Teams)).toMatchSnapshot();
    });

    it('per-player stats for round 2', async () => {
        await setup;
        const round2Teams = result.stats[1]!.teams;
        expect(sanitizeForSnapshot(round2Teams)).toMatchSnapshot();
    });

    it('damage stats exist flag', async () => {
        await setup;
        expect(result.stats[0]!.damage_stats_exist).toMatchSnapshot();
        expect(result.stats[1]!.damage_stats_exist).toMatchSnapshot();
    });
});
