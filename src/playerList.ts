import Player from './player.js';
import { TeamColor } from './constants.js';

class PlayerList {
    // Each individual player has a per-team Player object to allow
    // tracking of separate stats across team changes in the same round
    // as well as to enable accurate tracking in Event objects about
    // which team a player was on at the time of the event.
    private teams: { [team in TeamColor]?: Player[]; };

    constructor() {
        this.teams = {};
    }

    // TODO: these parameters shouldn't be optional.
    public ensurePlayer(steamID: string, name?: string, playerID?: number, team?: TeamColor): Player | undefined {
        if (team === undefined) {
            throw "team must be set";
        }
        const player = this.getPlayer(steamID, team);
        if (player)
            return player;

        if (name && playerID) {
            const newPlayer = new Player(steamID, name!, playerID!, team!);
            if (!this.teams[team]) {
                this.teams[team] = [];
            }
            this.teams[team]!.push(newPlayer);
            return newPlayer;
        }
        throw "name and playerID must be set";
    }

    private getPlayer(steamID: string, team: TeamColor): Player | undefined {
        const players = this.teams[team];
        if (players) {
            const player = players.find((p) => p.steamID === steamID);
            if (player) {
                return player;
            }
        }
        return undefined;
    }
}

export default PlayerList;