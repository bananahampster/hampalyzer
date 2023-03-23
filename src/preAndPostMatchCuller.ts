import { Event } from "./parser.js";
import EventType from './eventType.js';
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import { RoundState } from "./roundState.js";

const eventsNotToCull = [
    EventType.MapLoading,
    EventType.ServerName,
    EventType.PlayerJoinTeam,
    EventType.PlayerChangeRole,
    EventType.PlayerMM1,
    EventType.PlayerMM2,
    EventType.ServerSay,
    EventType.ServerCvar,
    EventType.PrematchEnd,
    EventType.TeamScore
];

export class PreAndPostMatchCuller implements EventSubscriber {
    private matchStartEvent?: Event;
    private matchStartLineNumber?: number;
    private matchEndEvent?: Event;
    private matchEndLineNumber?: number;

    constructor() {
    }

    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {
        switch (phase) {
            case EventHandlingPhase.Initial: // Initial phase: identify the start and end events.
                break;
            case EventHandlingPhase.EarlyFixups: // Write out game time on events and remove pre/post-match events we don't need.
                this.matchStartLineNumber = this.matchStartEvent!.lineNumber;
                if (this.matchEndEvent) {
                    this.matchEndLineNumber = this.matchEndEvent.lineNumber;
                }
                break;
            default:
                throw "Unexpected phase";
        }

    }

    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest {
        switch (phase) {
            case EventHandlingPhase.Initial:
                if (!this.matchStartEvent) {
                    // Assume the first line of the log is the start until/unless we see a prematch end event.
                    this.matchStartEvent = event;
                }
                switch (event.eventType) {
                    case EventType.PrematchEnd:
                        this.matchStartEvent = event;
                        break;
                    case EventType.TeamScore:
                        this.matchEndEvent = event;
                        break;
                    default:
                        break;
                }
                return HandlerRequest.None;
            case EventHandlingPhase.EarlyFixups:
                // Will be negative if a pre-match event.
                event.gameTimeAsSeconds = Math.round((event.timestamp.getTime() - this.matchStartEvent!.timestamp.getTime()) / 1000);

                if (event.lineNumber < this.matchStartLineNumber! || (this.matchStartLineNumber !== undefined && event.lineNumber > this.matchEndLineNumber!)) {
                    if (eventsNotToCull.indexOf(event.eventType) === -1) {
                        return HandlerRequest.RemoveEvent;
                    }
                    else if (event.gameTimeAsSeconds === 0) {
                        // Also cull suicides and damage due to prematch end.
                        if (event.eventType === EventType.PlayerCommitSuicide ||
                            event.eventType === EventType.PlayerDamage) {
                            HandlerRequest.RemoveEvent;
                        }
                    }
                }
                return HandlerRequest.None;
            default:
                throw "Unexpected phase";
        }
        return HandlerRequest.None;
    }

}