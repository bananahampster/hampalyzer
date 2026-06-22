import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parsing/match-parser.js';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, '.');

describe('Parser - full integration (schtop 2-round match)', () => {
    it('parses a 2-round match and produces valid ParsedStats', async () => {
        const parser = new Parser(
            resolve(fixtureDir, 'L0308008.log'),
            resolve(fixtureDir, 'L0308009.log'),
        );

        const result = await parser.parseRounds(/* skipValidation */ true);

        expect(result.isValid).toBe(true);
        expect(result.stats).toHaveLength(2);
        expect(result.players).toBeDefined();
        expect(result.comparison).toBeDefined();

        // Snapshot the output stats (excluding rawStats which has circular refs)
        const { rawStats, ...snapshotSafe } = result;
        // Strip Event[] from GenericStats to avoid circular player refs
        const sanitized = JSON.parse(JSON.stringify(snapshotSafe, (key, value) => {
            if (key === 'events' && Array.isArray(value)) return undefined;
            if (key === 'playerFrom' || key === 'playerTo') return undefined;
            return value;
        }));
        expect(sanitized).toMatchSnapshot();
    });

    it('parses L0522 fixture pair', async () => {
        const parser = new Parser(
            resolve(fixtureDir, 'L0522000.log'),
            resolve(fixtureDir, 'L0522001.log'),
        );

        const result = await parser.parseRounds(/* skipValidation */ true);

        expect(result.isValid).toBe(true);
        expect(result.stats).toHaveLength(2);

        const { rawStats, ...snapshotSafe } = result;
        const sanitized = JSON.parse(JSON.stringify(snapshotSafe, (key, value) => {
            if (key === 'events' && Array.isArray(value)) return undefined;
            if (key === 'playerFrom' || key === 'playerTo') return undefined;
            return value;
        }));
        expect(sanitized).toMatchSnapshot();
    });
});

describe('Parser - single round', () => {
    it('parses a single round successfully', async () => {
        const parser = new Parser(
            resolve(fixtureDir, 'L0308008.log'),
        );

        const result = await parser.parseRounds(/* skipValidation */ true);

        expect(result.isValid).toBe(true);
        expect(result.stats).toHaveLength(1);
        expect(result.comparison).toBeUndefined();

        const { rawStats, ...snapshotSafe } = result;
        const sanitized = JSON.parse(JSON.stringify(snapshotSafe, (key, value) => {
            if (key === 'events' && Array.isArray(value)) return undefined;
            if (key === 'playerFrom' || key === 'playerTo') return undefined;
            return value;
        }));
        expect(sanitized).toMatchSnapshot();
    });
});
