import { OutputPlayer } from "./constants.js";
import { TeamColor } from "./constants.js";
import { TimeInterval } from "./timeInterval.js";

export class PlayerRoundStats {
    public flagCarries = 0;
    public flagInitialTouches = 0;
    public flagThrows = 0;
    public flagCarryTimeInSeconds = 0;
}
export class PlayerCurrentStatus {
    public carryingFlag = false;
    public carryingFlagBonus = false;
}

class Player {
    private steamNum: string;
    private names: string[];
    private playerNum: number;
    private teamColor: TeamColor;
    private intervalsOnTeam: TimeInterval[];
    private leftTeamTimeInGameSeconds: number | undefined;
    private _roundStats: PlayerRoundStats;
    private _currentStatus: PlayerCurrentStatus;

    constructor(steamID: string, name: string, playerID: number, team: TeamColor) {
        this.steamNum = steamID;
        this.names = [name];
        this.playerNum = playerID;
        this.teamColor = team;
        this.intervalsOnTeam = [];
        this._roundStats = new PlayerRoundStats();
        this._currentStatus = new PlayerCurrentStatus();
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
        return this._roundStats;
    }

    public get currentStatus(): PlayerCurrentStatus { 
        return this._currentStatus;
    }

    public recordJoinTeamTime(joinTeamTimeInGameSeconds: number) {
        if (this.intervalsOnTeam.length > 0 &&
            (this.intervalsOnTeam[this.intervalsOnTeam.length -1].startTimeInSeconds === joinTeamTimeInGameSeconds ||
            this.intervalsOnTeam[this.intervalsOnTeam.length -1].endTimeInSeconds === undefined)) {
            // Duplicate join time.
            return;
        }
        this.intervalsOnTeam.push(new TimeInterval(joinTeamTimeInGameSeconds, undefined));
    }
    public recordLeaveTeamTime(leaveTeamTimeInGameSeconds: number) {
        this.intervalsOnTeam[this.intervalsOnTeam.length - 1].setEndTime(leaveTeamTimeInGameSeconds);
    }
    public getTotalRoundTimeInSeconds(gameEndTimeInGameSeconds: number) {
        let time = 0;
        for (let i = 0; i < this.intervalsOnTeam.length; i++) {
            time += this.intervalsOnTeam[i].getClampedDuration(0, gameEndTimeInGameSeconds)!;
        }
        return time;
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