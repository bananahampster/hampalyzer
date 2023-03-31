import { Event } from "./parser.js";
import EventType from './eventType.js';
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import { RoundState } from "./roundState.js";
import { TeamScore, TeamComposition } from "./parserUtils.js";
import { TeamFlagMovements } from "./constants.js";
import Player from "./player.js";
import { PlayerRoundStats } from "./player.js";
import { TeamColor } from "./constants.js";
import { PlayerClass } from "./constants.js";

class TeamFlagRoundStats {
    public numberOfCaps: number = 0;
    public numberOfBonusCaps: number = 0;
    public teamFlagHoldBonuses: number = 0;
    public score: number = 0;
    public flagEvents: Event[] = [];
}

class FlagStatus {
    public carrier: Player | null = null;
    public timeFlagWasPickedUpInGameSeconds: number | null = null;
    public bonusActive: boolean = false;
    public hasBeenTouched: boolean = false;
}

export class FlagMovementTracker implements EventSubscriber {
    // Tracks the player current carrying the flag of a given TeamColor.
    // For example, a blue player carrying the red flag would be tracked via
    // TeamColor.Red.
    private currentFlagStatusByTeam: Record<TeamColor, FlagStatus>;
    private sawTeamScoresEvent: boolean = false;
    private flagRoundStatsByTeam: Record<TeamColor, TeamFlagRoundStats>;
    
    private pointsPerCap = 10;
    private pointsPerBonusCap = this.pointsPerCap;

    constructor() {
        this.currentFlagStatusByTeam = {
            [TeamColor.None]: new FlagStatus(),
            [TeamColor.Blue]: new FlagStatus(),
            [TeamColor.Red]: new FlagStatus(),
            [TeamColor.Green]: new FlagStatus(),
            [TeamColor.Yellow]: new FlagStatus(),
            [TeamColor.Spectator]: new FlagStatus(),
        };

        this.flagRoundStatsByTeam = {
            [TeamColor.None]: new TeamFlagRoundStats(),
            [TeamColor.Blue]: new TeamFlagRoundStats(),
            [TeamColor.Red]: new TeamFlagRoundStats(),
            [TeamColor.Green]: new TeamFlagRoundStats(),
            [TeamColor.Yellow]: new TeamFlagRoundStats(),
            [TeamColor.Spectator]: new TeamFlagRoundStats(),
        };
    }

    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {
        switch (phase) {
            case EventHandlingPhase.Main:
                break;
            default:
                throw "Unexpected phase";
        }
    }

    phaseEnd(phase: EventHandlingPhase, roundState: RoundState): void {
        switch (phase) {
            case EventHandlingPhase.Main:
                for (let team in this.currentFlagStatusByTeam) {
                    if (this.currentFlagStatusByTeam[team].carrier !== null) {
                        // The flag was being held when the game ended.
                        this.currentFlagStatusByTeam[team].carrier.flagCarryTimeInSeconds +=
                            roundState.roundEndTimeInGameSeconds - this.currentFlagStatusByTeam[team].timeFlagWasPickedUpInGameSeconds;
                    }
                    this.currentFlagStatusByTeam[team] = new FlagStatus();
                }
                this.computePointsPerCap();
                if (!this.sawTeamScoresEvent) { // The server may have crashed before finishing the log.
                    console.warn("Can't find ending score, manually counting caps...");
                }
                break;
            default:
                throw "Unexpected phase";
        }
    }

    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest {
        switch (phase) {
            case EventHandlingPhase.Main:
                switch (event.eventType) {
                    case EventType.TeamFlagHoldBonus:
                        this.flagRoundStatsByTeam[event.data!.team!].teamFlagHoldBonuses++;
                        this.flagRoundStatsByTeam[event.data!.team!].flagEvents.push(event);
                        break;
                    case EventType.TeamScore:
                        {
                            const team = event.data && event.data.team;
                            const score = event.data && event.data.value;
                            if (!team) {
                                throw "expected team with a TeamScore event";
                            }
                            if (!score) {
                                throw "expected value with a TeamScore event";
                            } 
                            this.flagRoundStatsByTeam[team].score = Number(score);
                            this.sawTeamScoresEvent = true;
                        }
                        break;
                    case EventType.PlayerPickedUpFlag:
                        {
                            this.flagRoundStatsByTeam[event.playerFrom!.team].flagEvents.push(event);

                            let flagStatusToUpdate = this.currentFlagStatusByTeam[event.data!.team!]!;
                            let player = event.playerFrom!;
                            flagStatusToUpdate.carrier = player;
                            player.roundStats.flagCarries++;
                            if (!flagStatusToUpdate.hasBeenTouched) {
                                flagStatusToUpdate.hasBeenTouched = true;
                                player.roundStats.flagFirstTouches++;
                            }
                            flagStatusToUpdate.bonusActive = false;
                            flagStatusToUpdate.timeFlagWasPickedUpInGameSeconds = event.gameTimeAsSeconds!;
                        }
                        break;
                    case EventType.PlayerPickedUpBonusFlag:
                        {
                            this.flagRoundStatsByTeam[event.playerFrom!.team].flagEvents.push(event);

                            let flagStatusToUpdate = this.currentFlagStatusByTeam[event.data!.team!];
                            if (!flagStatusToUpdate.carrier || !flagStatusToUpdate.carrier.matches(event.playerFrom!)) {
                                console.error("Bonus flag pickup seen by a player (" + event.playerFrom!.name + ") which wasn't carrying the flag"
                                    + " (was carried by " + flagStatusToUpdate.carrier!.name + ")");
                            }
                            else {
                                flagStatusToUpdate.bonusActive = true;
                            }
                        }
                        break;
                    case EventType.FlagReturn:
                        if (!event.data) {
                            // TODO: throw here instead and determine if it's possible to see a flag return without a team associated with it.
                            for (let team in this.currentFlagStatusByTeam) {
                                this.currentFlagStatusByTeam[team] = new FlagStatus();
                            }
                            break;
                        }
                        this.currentFlagStatusByTeam[event.data.team!] = new FlagStatus();
                        break;
                    case EventType.PlayerFraggedPlayer:
                    case EventType.PlayerCommitSuicide:
                    case EventType.PlayerLeftServer:
                    case EventType.PlayerThrewFlag:
                        {
                            let flagDropper = event.eventType === EventType.PlayerFraggedPlayer ? event.playerTo : event.playerFrom;
                            this.flagRoundStatsByTeam[flagDropper!.team].flagEvents.push(event);
                            if (event.eventType === EventType.PlayerThrewFlag) {
                                flagDropper!.roundStats.flagThrows++;
                            }
                            for (let team in this.currentFlagStatusByTeam) {
                                if (flagDropper!.isSamePlayer(this.currentFlagStatusByTeam[team].carrier)) {

                                    flagDropper!.roundStats.flagCarryTimeInSeconds +=
                                    event.gameTimeAsSeconds! - this.currentFlagStatusByTeam[team].timeFlagWasPickedUpInGameSeconds;

                                    this.currentFlagStatusByTeam[team].carrier = null;
                                    this.currentFlagStatusByTeam[team].bonusActive = false;
                                    // TODO: add flag carrier kill tracking
                                }
                            }
                        }
                        break;
                    case EventType.PlayerCapturedFlag:
                        let foundCarrierInFlagStatuses = false;
                        for (let team in this.currentFlagStatusByTeam) {
                            let currentFlagStatus = this.currentFlagStatusByTeam[team];
                            if (event.playerFrom?.isSamePlayer(currentFlagStatus.carrier)) {
                                if (currentFlagStatus.bonusActive === true) {
                                    event.eventType = EventType.PlayerCapturedBonusFlag;
                                }
                                this.flagRoundStatsByTeam[event.playerFrom!.team].numberOfCaps++;
                                this.flagRoundStatsByTeam[event.playerFrom!.team].flagEvents.push(event);

                                let flagTime = event.gameTimeAsSeconds! - currentFlagStatus.timeFlagWasPickedUpInGameSeconds;

                                this.currentFlagStatusByTeam[team] = new FlagStatus();

                                // TODO: add flag carrier kill tracking

                                foundCarrierInFlagStatuses = true;
                                break;
                            }
                        }
                        if (!foundCarrierInFlagStatuses) {
                            console.error(`Flag cap seen by a player (${event.playerFrom!.name}) which wasn't carrying the flag (line ${event.lineNumber})`);
                        }
                        break;
                    default:
                        break;
                }
                break;
            case EventHandlingPhase.PostMain:
                break;
            default:
                throw "Unexpected phase";
        }
        return HandlerRequest.None;
    }


    private computePointsPerCap() {
        const pointsPerTeamFlagHoldBonus = 5; // Assume 5 points for flag hold bonus (ss_nyx_ectfc).
        if (this.sawTeamScoresEvent) {
            const blueTeamFlagRoundStats = this.flagRoundStatsByTeam[TeamColor.Blue];

            const firstTeamFlagHoldBonuses = blueTeamFlagRoundStats.teamFlagHoldBonuses;
            const pointsFromFlagHoldBonuses = blueTeamFlagRoundStats.numberOfBonusCaps* pointsPerTeamFlagHoldBonus;

            if (blueTeamFlagRoundStats.score > 0 && blueTeamFlagRoundStats.numberOfBonusCaps > 0) {
                // This is a map with bonus caps, e.g. raiden6's coast-to-coast mechanic.
                // To estimate the values for a normal cap and a bonus cap, assume a normal cap value of 10.
                this.pointsPerCap = 10;
                const estimatedBonusPointsTotal = blueTeamFlagRoundStats.score - (this.pointsPerCap * (blueTeamFlagRoundStats.numberOfCaps + blueTeamFlagRoundStats.numberOfBonusCaps));
                this.pointsPerBonusCap = this.pointsPerCap + (estimatedBonusPointsTotal / blueTeamFlagRoundStats.numberOfCaps);
                console.log(`Estimate points for a bonus cap is ${this.pointsPerBonusCap}`);
            }
            else {
                this.pointsPerCap = blueTeamFlagRoundStats.score ?
                    (blueTeamFlagRoundStats.numberOfCaps > 0 ?
                        ((blueTeamFlagRoundStats.score - pointsFromFlagHoldBonuses) / blueTeamFlagRoundStats.numberOfCaps) : this.pointsPerCap)
                    : this.pointsPerCap;
            }
            if (this.pointsPerCap != 10) {
                console.warn(`Points per cap is ${this.pointsPerCap}`);
            }
        }
    }
}
