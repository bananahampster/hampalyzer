import { EventHandlingPhase, EventSubscriber, SubscriberList } from "./eventSubscriberManager.js";
import { PlayerTeamTracker } from "./playerTeamTracker.js";
import { Event } from "./parser.js";

class PreAndPostMatchHandler implements EventSubscriber {
    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): void {
        //console.log("PreAndPostMatchHandler handled event in phase " + EventHandlingPhase[phase] + ": " + event.lineNumber);
    }
}
class FlagMovementHandler implements EventSubscriber {
    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): void {
        //console.log("FlagMovementHandler handled event in phase " + EventHandlingPhase[phase] + ": " + event.lineNumber);
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
            playerTeamStateHandler: { subscriber: this.playerTeamTracker, phases: [EventHandlingPhase.Phase0]},
            preAndPostMatchHandler: { subscriber: new PreAndPostMatchHandler(), phases: [EventHandlingPhase.Phase0, EventHandlingPhase.Phase1]},
            anotherHandler: { subscriber: new FlagMovementHandler(), phases: [EventHandlingPhase.Phase0]},
        };
    }

    get currentTeams() {
        return this.playerTeamTracker.currentTeams;
    } 
}