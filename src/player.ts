import { OutputPlayer } from "./constants.js";
import { TeamColor } from "./constants.js";

export class PlayerRoundStats {
    public flagCarries = 0;
    public flagInitialTouches = 0;
    public flagThrows = 0;
    public flagCarryTimeInSeconds = 0;
}

class Player {
    private steamNum: string;
    private names: string[];
    private playerNum: number;
    private teamColor: TeamColor;
    private currentRoundStats: PlayerRoundStats;

    constructor(steamID: string, name: string, playerID: number, team: TeamColor) {
        this.steamNum = steamID;
        this.names = [name];
        this.playerNum = playerID;
        this.teamColor = team;
        this.currentRoundStats = new PlayerRoundStats();
    }

    public isSamePlayer(other: Player): boolean {
        if (!other) {
            return false;
        }
        return this.steamNum === other.steamNum && this.teamColor == other.teamColor;
    }

    public addName(name: string): void {
        if (this.names.indexOf(name) === -1)
            this.names.push(name);
    }

    // return the last name??
    public get name(): string {
        return this.names[this.names.length - 1];
    }

    public get steamID(): string {
        return this.steamNum;
    }

    public get playerID(): number { 
        return this.playerNum;
    }

    public get team(): TeamColor {
        return this.teamColor;
    }

    public get roundStats(): PlayerRoundStats { 
        return this.currentRoundStats;
    }

    public toString(): string {
        return this.name;
    }

    public matches(other: Player | OutputPlayer) {
        return this.steamID === other.steamID;
    }

    public dumpOutput(teamNum: number = 1): OutputPlayer {
        return {
            name: this.name,
            steamID: this.steamID,
            team: teamNum,
            id: this.steamID.split(":")[2],
        };
    }
}

export default Player;