import { EventHandlingPhase, EventSubscriber, HandlerRequest, SubscriberList } from "./eventSubscriberManager.js";
import { PlayerTeamTracker } from "./playerTeamTracker.js";
import { PreAndPostMatchCuller } from "./preAndPostMatchCuller.js";
import { Event } from "./parser.js";
import Player from "./player.js";

class FlagMovementHandler implements EventSubscriber {
    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {
    }

    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest {
        //console.log("FlagMovementHandler handled event in phase " + EventHandlingPhase[phase] + ": " + event.lineNumber);
        return HandlerRequest.None;
    }
}

// This class accumulates state via parsed events being handled by different subscribers/state machines.
export class RoundState {
    // The players seen throughout the round.
    private playerTeamTracker: PlayerTeamTracker;

    constructor() {
        this.playerTeamTracker = new PlayerTeamTracker();
    }

    public getEventSubscribers(): SubscriberList {
        return {
            playerTeamStateHandler: { subscriber: this.playerTeamTracker, phases: [EventHandlingPhase.Initial]},
            preAndPostMatchHandler: { subscriber: new PreAndPostMatchCuller(), phases: [EventHandlingPhase.Initial, EventHandlingPhase.EarlyFixups]},
            anotherHandler: { subscriber: new FlagMovementHandler(), phases: [EventHandlingPhase.Main]},
        };
    }

    public ensurePlayer(steamID: string, name?: string, playerID?: number): Player | undefined {
        return this.playerTeamTracker.ensurePlayer(steamID, name, playerID);
    }

    get currentTeams() {
        return this.playerTeamTracker.currentTeams;
    } 
    get players() {
        return this.playerTeamTracker.players;
    } 
}