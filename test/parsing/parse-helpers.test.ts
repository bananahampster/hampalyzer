import { describe, expect, it } from 'vitest';
import { explodeLine, parseClass, parseTeam, parseWeapon } from '../../src/parsing/line-parsers/parse-helpers.js';
import { PlayerClass, TeamColor, Weapon } from '../../src/models/types.js';

function getThrownValue(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return undefined;
}

describe('parse helpers', () => {
    describe('explodeLine', () => {
        it('splits plain space-delimited strings', () => {
            expect(explodeLine('hello world')).toEqual(['hello', 'world']);
        });

        it('preserves quoted substrings without quotes', () => {
            expect(explodeLine('hello "world foo" bar')).toEqual(['hello', 'world foo', 'bar']);
        });

        it('returns an empty array for an empty string', () => {
            expect(explodeLine('')).toEqual([]);
        });
    });

    describe('parseClass', () => {
        it.each([
            ['Scout', PlayerClass.Scout],
            ['Sniper', PlayerClass.Sniper],
            ['Soldier', PlayerClass.Soldier],
            ['Demoman', PlayerClass.Demoman],
            ['Medic', PlayerClass.Medic],
            ['HWGuy', PlayerClass.HWGuy],
            ['Pyro', PlayerClass.Pyro],
            ['Spy', PlayerClass.Spy],
            ['Engineer', PlayerClass.Engineer],
            ['Civilian', PlayerClass.Civilian],
            ['RandomPC', PlayerClass.Random],
        ])('maps %s to %s', (input, expected) => {
            expect(parseClass(input)).toBe(expected);
        });

        it('trims whitespace before parsing', () => {
            expect(parseClass('  Engineer  ')).toBe(PlayerClass.Engineer);
        });

        it('throws on unknown classes', () => {
            expect(getThrownValue(() => parseClass('UnknownClass'))).toBe('undefined player class: UnknownClass');
        });
    });

    describe('parseTeam', () => {
        it.each([
            ['Blue', TeamColor.Blue],
            ['Red', TeamColor.Red],
            ['Spectator', TeamColor.Spectator],
            ['blue', TeamColor.Blue],
            ['RED', TeamColor.Red],
        ])('maps %s to %s', (input, expected) => {
            expect(parseTeam(input)).toBe(expected);
        });

        it('handles map-specific team names', () => {
            expect(parseTeam('dustbowl_team1')).toBe(TeamColor.Blue);
            expect(parseTeam('dustbowl_team2')).toBe(TeamColor.Red);
        });

        it('falls back to substring matching', () => {
            expect(parseTeam('someblue')).toBe(TeamColor.Blue);
            expect(parseTeam('very-red-team')).toBe(TeamColor.Red);
        });

        it('throws on unknown teams', () => {
            expect(getThrownValue(() => parseTeam('mystery-team'))).toBe('unknown team: mystery-team');
        });
    });

    describe('parseWeapon', () => {
        it.each([
            ['rocket', Weapon.Rocket],
            ['shotgun', Weapon.Shotgun],
            ['rpg', Weapon.Rocket],
            ['axe', Weapon.Crowbar],
        ])('maps %s to %s', (input, expected) => {
            expect(parseWeapon(input)).toBe(expected);
        });

        it('strips a leading "with" prefix', () => {
            expect(parseWeapon('with rocket')).toBe(Weapon.Rocket);
        });

        it('handles quoted weapon names', () => {
            expect(parseWeapon('"rocket"')).toBe(Weapon.Rocket);
        });
    });
});
