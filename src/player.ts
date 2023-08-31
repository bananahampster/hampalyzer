import { OutputPlayer, PlayerClass } from "./constants.js";
import { ClassTime, DisplayStringHelper, TeamColor } from "./constants.js";
import { TimeInterval } from "./timeInterval.js";
import { TimeIntervalWithContext } from "./timeIntervalWithContext.js";

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
    private classIntervals: TimeIntervalWithContext<PlayerClass>[];
    private leftTeamTimeInGameSeconds: number | undefined;
    private _roundStats: PlayerRoundStats;
    private _currentStatus: PlayerCurrentStatus;

    constructor(steamID: string, name: string, playerID: number, team: TeamColor) {
        this.steamNum = steamID;
        this.names = [name];
        this.playerNum = playerID;
        this.teamColor = team;
        this.intervalsOnTeam = [];
        this.classIntervals = [];
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
            (this.intervalsOnTeam.at(-1)!.startTimeInSeconds === joinTeamTimeInGameSeconds ||
            this.intervalsOnTeam.at(-1)!.endTimeInSeconds === undefined)) {
            // Already on the team.
            return;
        }
        this.intervalsOnTeam.push(new TimeInterval(joinTeamTimeInGameSeconds, undefined));
    }
    public recordLeaveTeamTime(leaveTeamTimeInGameSeconds: number) {
        this.intervalsOnTeam.at(-1)!.setEndTime(leaveTeamTimeInGameSeconds);
    }

    public get currentClass(): PlayerClass | undefined {
        if (this.classIntervals.length > 0) {
            return this.classIntervals.at(-1)?.context;
        }
        return undefined;
    }
    public recordClassStartTime(playerClass: PlayerClass, classStartTimeInGameSeconds: number) {
        if (this.classIntervals.length > 0 &&
            this.classIntervals.at(-1)!.endTimeInSeconds === undefined &&
            this.classIntervals.at(-1)!.context === playerClass) {
            // Already this class.
            return;
        }
        if (this.classIntervals.length > 0) {
            // End the prior interval.
            this.classIntervals.at(-1)!.endTimeInSeconds = classStartTimeInGameSeconds;
        }
        this.classIntervals.push(new TimeIntervalWithContext<PlayerClass>(classStartTimeInGameSeconds, undefined, playerClass));
    }
    public recordClassEndTime(classEndTimeInGameSeconds: number) {
        if (this.classIntervals.length > 0 &&
            this.classIntervals.at(-1)!.endTimeInSeconds === undefined) {
            this.classIntervals.at(-1)!.endTimeInSeconds = classEndTimeInGameSeconds;
        }
    }

    public getPlayerClassTimes(gameEndTimeInGameSeconds: number): ClassTime[] {
        let classTimes: ClassTime[] = [];

        for (let i = 0; i < this.classIntervals.length; i++) {
            const curInterval = this.classIntervals[i];
            const classTime = curInterval.getClampedDuration(0, gameEndTimeInGameSeconds)!;
            if (classTime > 0) {
                classTimes.push({
                    class: curInterval.context,
                    classAsString: DisplayStringHelper.classToDisplayString(curInterval.context),
                    timeInSeconds: curInterval.getClampedDuration(0, gameEndTimeInGameSeconds)!
                });
            }
        }
        return classTimes;
    }
    
    public getPlayerClassesDisplayString(gameEndTimeInGameSeconds: number): string {
        let classTimes: ClassTime[] = this.getPlayerClassTimes(gameEndTimeInGameSeconds);
        let mergedClassTimes: ClassTime[] = [];

        for (let i = 0; i < classTimes.length; i++) {
            const curClassTime = classTimes[i];
            let mergedClassEntry = mergedClassTimes.find((c) => c.class == curClassTime.class);
            if (mergedClassEntry) {
                mergedClassEntry.timeInSeconds += curClassTime.timeInSeconds;
            }
            else {
                mergedClassTimes.push(curClassTime);
            }
        }
        mergedClassTimes.sort((a, b) => a.timeInSeconds < b.timeInSeconds ? 1 : -1);

        return mergedClassTimes.map(playerClass => PlayerClass[playerClass.class]).join(", ");
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