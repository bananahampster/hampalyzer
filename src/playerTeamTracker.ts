import { Event } from "./parser.js";
import EventType from './eventType.js';
import { TeamComposition } from "./parserUtils.js";
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import { RoundState } from "./roundState.js";
import { TeamColor } from "./constants.js";
import Player from "./player.js";
import PlayerList from "./playerList.js";

export class PlayerTeamTracker implements EventSubscriber {
    // The players seen throughout the round.
    public players: PlayerList;
    // The teams throughout the round.
    public teams: TeamComposition;
    // The current team composition.
    public currentTeams: TeamComposition;

    constructor() {
        this.players = new PlayerList();
        this.teams = {};
        this.currentTeams = {};
    }

    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {
    }

    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest {
        switch (event.eventType) {
            case EventType.PlayerJoinTeam:
                const team = event.data && event.data.team;
                if (!team) {
                    throw "expected team with a 'joined team' event";
                }
                this.setPlayerTeam(event.playerFrom!, team);
                break;
            case EventType.PlayerLeftServer:
            case EventType.PlayerKicked:
                this.setPlayerTeam(event.playerFrom!, undefined);
                break;
            default:
                break;
        }
        return HandlerRequest.None;
    }

    public ensurePlayer(steamID: string, name?: string, playerID?: number): Player | undefined {
        return this.players.ensurePlayer(steamID, name, playerID);
    }

    public setPlayerTeam(player: Player, team: TeamColor | undefined) {
        const playerObj = this.players.ensurePlayer(player.steamID, player.name, player.playerID);
        if (!playerObj) {
            throw "Couldn't get player: " + player.steamID;
        }
        if (playerObj) {
            if (team) {
                if (!this.teams[team]) {
                    this.teams[team] = [];
                }
                if (!this.currentTeams[team]) {
                    this.currentTeams[team] = [];
                }
                this.teams[team]!.push(playerObj);
            }
        }
        // Update currentTeams
        for (const [currentTeam, currentTeamMembers] of Object.entries(this.currentTeams)) {
            if (currentTeamMembers) {
                if (team && currentTeam === team.toString()) {
                    // Duplicate join team events have been observed in actual logs.
                    if (currentTeamMembers.indexOf(playerObj) == -1) {
                        currentTeamMembers.push(playerObj);
                    }
                }
                else {
                    // The player is not currently a part of this team.
                    const indexOfPlayerInTeam = currentTeamMembers.findIndex(p => p.steamID == playerObj.steamID);
                    if (indexOfPlayerInTeam !== -1) {
                        currentTeamMembers.splice(indexOfPlayerInTeam, 1);
                    }
                }
            }
        }
    }
}