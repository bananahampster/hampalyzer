import { Event } from "./parser.js";
import EventType from './eventType.js';
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import { RoundState } from "./roundState.js";
import { TeamColor, TeamComposition } from "./constants.js";
import Player from "./player.js";
import PlayerList from "./playerList.js";

export class PlayerTeamTracker extends EventSubscriber {
    // The players seen throughout the round.
    public players: PlayerList;

    // The current team composition.
    public currentTeams: TeamComposition;

    constructor() {
        super();

        this.players = new PlayerList();
        this.currentTeams = {};
    }

    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {}
    phaseEnd(phase: EventHandlingPhase, roundState: RoundState): void {}

    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest {
        switch (event.eventType) {
            case EventType.PlayerJoinTeam:
                const team = event.data && event.data.team;
                if (!team) {
                    throw "expected team with a 'joined team' event";
                }
                this.setPlayerTeam(event.playerFrom!, team, event.gameTimeAsSeconds);
                break;
            case EventType.PlayerLeftServer:
            case EventType.PlayerKicked:
                this.setPlayerTeam(event.playerFrom!, undefined, event.gameTimeAsSeconds);
                break;
            default:
                break;
        }
        return HandlerRequest.None;
    }

    public ensurePlayer(steamID: string, name?: string, playerID?: number, team?: TeamColor): Player | undefined {
        return this.players.ensurePlayer(steamID, name, playerID, team);
    }

    public setPlayerTeam(player: Player, team: TeamColor | undefined, gameTimeAsSeconds: number) {
        let playerObj: Player | undefined;

        // if a player has disconnected, we should take the player object as given and remove from current team
        if (team === undefined) {
            playerObj = player;
        }
        else {
            playerObj = this.players.ensurePlayer(player.steamID, player.name, player.playerID, team);
        }

        if (playerObj == null) {
            throw "Couldn't get player: " + player.steamID;
        }

        if (team) {
            playerObj.recordJoinTeamTime(gameTimeAsSeconds);
        }

        if (playerObj) {
            if (team) {
                if (!this.currentTeams[team]) {
                    this.currentTeams[team] = [];
                }
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
                    const indexOfPlayerInTeam = currentTeamMembers.findIndex(p => p.steamID === playerObj!.steamID);

                    if (indexOfPlayerInTeam !== -1) {
                        const removed: Player = currentTeamMembers.splice(indexOfPlayerInTeam, 1)[0];
                        removed.recordLeaveTeamTime(gameTimeAsSeconds);
                    }
                }
            }
        }
    }
}