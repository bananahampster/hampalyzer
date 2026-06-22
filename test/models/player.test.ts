import { describe, expect, it } from 'vitest';
import Player from '../../src/models/player.js';
import { PlayerClass, TeamColor } from '../../src/models/types.js';

describe('Player', () => {
    it('sets fields correctly on construction', () => {
        const player = new Player('0:0:123', 'PlayerA', 7, TeamColor.Blue);

        expect(player.steamID).toBe('0:0:123');
        expect(player.name).toBe('PlayerA');
        expect(player.playerID).toBe(7);
        expect(player.team).toBe(TeamColor.Blue);
        expect(player.id).toBeNull();
    });

    it('considers players with the same steam id and team to be the same player', () => {
        const player = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);
        const same = new Player('0:0:123', 'Alias', 2, TeamColor.Blue);
        const differentTeam = new Player('0:0:123', 'Alias', 2, TeamColor.Red);

        expect(player.isSamePlayer(same)).toBe(true);
        expect(player.isSamePlayer(differentTeam)).toBe(false);
    });

    it('adds new names without duplicating existing ones', () => {
        const player = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);

        player.addName('Alias');
        player.addName('Alias');

        expect((player as unknown as { names: string[] }).names).toEqual(['PlayerA', 'Alias']);
        expect(player.name).toBe('Alias');
    });

    it('tracks time spent on team across intervals', () => {
        const player = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);

        player.recordJoinTeamTime(5);
        player.recordLeaveTeamTime(20);
        player.recordJoinTeamTime(30);

        expect(player.getTotalRoundTimeInSeconds(50)).toBe(35);
    });

    it('tracks class intervals and produces a merged display string', () => {
        const player = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);

        player.recordClassStartTime(PlayerClass.Scout, 0);
        player.recordClassStartTime(PlayerClass.Medic, 10);
        player.recordClassStartTime(PlayerClass.Scout, 20);

        expect(player.currentClass).toBe(PlayerClass.Scout);
        expect(player.getPlayerClassTimes(50)).toEqual([
            { class: PlayerClass.Scout, classAsString: 'scout', timeInSeconds: 10 },
            { class: PlayerClass.Medic, classAsString: 'medic', timeInSeconds: 10 },
            { class: PlayerClass.Scout, classAsString: 'scout', timeInSeconds: 30 },
        ]);
        expect(player.getPlayerClassesDisplayString(50)).toBe('Scout, Medic');
    });

    it('dumps output in the expected shape', () => {
        const player = new Player('0:0:123', 'PlayerA', 1, TeamColor.Blue);

        expect(player.dumpOutput(2)).toEqual({
            name: 'PlayerA',
            steamID: '0:0:123',
            team: 2,
            id: '123',
        });
    });
});
