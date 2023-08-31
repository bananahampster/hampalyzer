import Player from './player.js';
import { TeamComposition, TeamColor } from './constants.js';

class PlayerList {
    // Each individual player has a per-team Player object to allow
    // tracking of separate stats across team changes in the same round
    // as well as to enable accurate tracking in Event objects about
    // which team a player was on at the time of the event.
    private _teams: TeamComposition<Player>;

    constructor() {
        this._teams = {};
    }

    // Used for directly adding a player, e.g. when building a new PlayerList from an existing one.
    public addPlayer(player: Player) {
        if (!this._teams[player.team]) {
            this._teams[player.team] = [];
        }
        this._teams[player.team]!.push(player);
    }

    public ensurePlayer(steamID: string, name?: string, playerID?: number, team?: TeamColor): Player | undefined {
        if (team === undefined) {
            throw "team must be set";
        }
        const player = this.getPlayer(steamID, team);
        if (player)
            return player;

        if (name && playerID) {
            const newPlayer = new Player(steamID, name!, playerID!, team!);
            if (!this._teams[team]) {
                this._teams[team] = [];
            }
            this._teams[team]!.push(newPlayer);
            return newPlayer;
        }
        throw "name and playerID must be set";
    }

    private getPlayer(steamID: string, team: TeamColor): Player | undefined {
        const players = this._teams[team];
        if (players) {
            const player = players.find((p) => p.steamID === steamID);
            if (player) {
                return player;
            }
        }
        return undefined;
    }

    public get teams() {
        return this._teams;
    }
}

export default PlayerList;