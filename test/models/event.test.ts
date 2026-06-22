import { describe, expect, it } from 'vitest';
import { Event } from '../../src/models/event.js';
import EventType from '../../src/models/event-types.js';
import Player from '../../src/models/player.js';
import { PlayerClass, TeamColor, Weapon } from '../../src/models/types.js';

describe('Event', () => {
    it('sets all provided fields during construction', () => {
        const timestamp = new Date('2024-01-02T12:00:00Z');
        const playerFrom = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);
        const playerTo = new Player('0:0:456', 'PlayerB', 2, TeamColor.Red);

        const event = new Event({
            eventType: EventType.PlayerFraggedPlayer,
            rawLine: 'raw line',
            lineNumber: 42,
            timestamp,
            data: { key: 'map', value: 'schtop', team: TeamColor.Blue },
            playerFrom,
            playerFromClass: PlayerClass.Soldier,
            playerTo,
            playerToClass: PlayerClass.Medic,
            withWeapon: Weapon.Rocket,
        });

        expect(event.eventType).toBe(EventType.PlayerFraggedPlayer);
        expect(event.rawLine).toBe('raw line');
        expect(event.lineNumber).toBe(42);
        expect(event.timestamp).toBe(timestamp);
        expect(event.data).toEqual({ key: 'map', value: 'schtop', team: TeamColor.Blue });
        expect(event.playerFrom).toBe(playerFrom);
        expect(event.playerFromClass).toBe(PlayerClass.Soldier);
        expect(event.playerTo).toBe(playerTo);
        expect(event.playerToClass).toBe(PlayerClass.Medic);
        expect(event.withWeapon).toBe(Weapon.Rocket);
    });

    it('initializes later-filled fields with defaults', () => {
        const event = new Event({
            eventType: EventType.PlayerJoinTeam,
            rawLine: 'raw line',
            lineNumber: 1,
            timestamp: new Date('2024-01-02T12:00:00Z'),
        });

        expect(event.gameTimeAsSeconds).toBe(-1);
        expect(event.whileConced).toBe(false);
        expect(event.playerFromWasCarryingFlag).toBe(false);
        expect(event.playerToWasCarryingFlag).toBe(false);
        expect(event.playerFrom).toBeUndefined();
        expect(event.playerTo).toBeUndefined();
        expect(event.withWeapon).toBeUndefined();
    });

    it('returns value and key from extra data when present', () => {
        const event = new Event({
            eventType: EventType.MapLoading,
            rawLine: 'raw line',
            lineNumber: 1,
            timestamp: new Date('2024-01-02T12:00:00Z'),
            data: { key: 'map', value: 'schtop' },
        });

        expect(event.value).toBe('schtop');
        expect(event.key).toBe('map');
    });

    it('falls back to unknown value and key when extra data is absent', () => {
        const event = new Event({
            eventType: EventType.MapLoading,
            rawLine: 'raw line',
            lineNumber: 1,
            timestamp: new Date('2024-01-02T12:00:00Z'),
        });

        expect(event.value).toBe('(unknown)');
        expect(event.key).toBe('(unknown)');
    });
});
