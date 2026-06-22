import { describe, expect, it } from 'vitest';
import { createEventFromLine } from '../../src/parsing/log-line-parser.js';
import { RoundState } from '../../src/state/round-state.js';
import EventType from '../../src/models/event-types.js';
import { PlayerClass, TeamColor, Weapon } from '../../src/models/types.js';

describe('createEventFromLine', () => {
    function createRoundState(): RoundState {
        return new RoundState();
    }

    it('parses kill events', () => {
        const roundState = createRoundState();
        const line = 'L 01/02/2024 - 12:00:00: "PlayerA<1><STEAM_0:0:123><Blue>" killed "PlayerB<2><STEAM_0:0:456><Red>" with "rocket"';

        const event = createEventFromLine(1, line, roundState);

        expect(event).toBeDefined();
        expect(typeof event).not.toBe('string');
        expect(event && typeof event !== 'string' ? event.eventType : undefined).toBe(EventType.PlayerFraggedPlayer);
        expect(event && typeof event !== 'string' ? event.playerFrom?.name : undefined).toBe('PlayerA');
        expect(event && typeof event !== 'string' ? event.playerTo?.name : undefined).toBe('PlayerB');
        expect(event && typeof event !== 'string' ? event.playerFrom?.team : undefined).toBe(TeamColor.Blue);
        expect(event && typeof event !== 'string' ? event.playerTo?.team : undefined).toBe(TeamColor.Red);
        expect(event && typeof event !== 'string' ? event.withWeapon : undefined).toBe(Weapon.Rocket);
    });

    it('parses suicide events', () => {
        const roundState = createRoundState();
        const line = 'L 01/02/2024 - 12:00:00: "PlayerA<1><STEAM_0:0:123><Blue>" committed suicide with "worldspawn"';

        const event = createEventFromLine(2, line, roundState);

        expect(event && typeof event !== 'string' ? event.eventType : undefined).toBe(EventType.PlayerCommitSuicide);
        expect(event && typeof event !== 'string' ? event.playerTo : undefined).toBe(event && typeof event !== 'string' ? event.playerFrom : undefined);
        expect(event && typeof event !== 'string' ? event.withWeapon : undefined).toBe(Weapon.WorldSpawn);
    });

    it('parses team join events', () => {
        const roundState = createRoundState();
        const line = 'L 01/02/2024 - 12:00:00: "PlayerA<1><STEAM_0:0:123><Blue>" joined team "Blue"';

        const event = createEventFromLine(3, line, roundState);

        expect(event && typeof event !== 'string' ? event.eventType : undefined).toBe(EventType.PlayerJoinTeam);
        expect(event && typeof event !== 'string' ? event.playerTo : undefined).toBe(event && typeof event !== 'string' ? event.playerFrom : undefined);
        expect(event && typeof event !== 'string' ? event.data?.team : undefined).toBe(TeamColor.Blue);
    });

    it('returns undefined for invalid non-log lines', () => {
        expect(createEventFromLine(4, 'something else', createRoundState())).toBeUndefined();
    });

    it('skips HLTV lines', () => {
        const line = 'L 01/02/2024 - 12:00:00: "SourceTV<0><HLTV><>" triggered "Game_Commencing"';

        expect(createEventFromLine(5, line, createRoundState())).toBeUndefined();
    });

    it('parses class change events', () => {
        const roundState = createRoundState();
        const line = 'L 01/02/2024 - 12:00:00: "PlayerA<1><STEAM_0:0:123><Blue>" changed role to "Medic"';

        const event = createEventFromLine(6, line, roundState);

        expect(event && typeof event !== 'string' ? event.eventType : undefined).toBe(EventType.PlayerChangeRole);
        expect(event && typeof event !== 'string' ? event.data?.class : undefined).toBe(PlayerClass.Medic);
        expect(event && typeof event !== 'string' ? event.playerFrom?.name : undefined).toBe('PlayerA');
    });
});
