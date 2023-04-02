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
    private lastEvent?: Event;
    private matchEndLineNumber?: number;
    private previousEventGameTimeAsSeconds?: number;
    private eventGameTimeAsSecondsAdjustment: number = 0;

    constructor() {
    }

    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void {
        switch (phase) {
            case EventHandlingPhase.Initial: // Initial phase: identify the start and end events.
                break;
            case EventHandlingPhase.EarlyFixups: // Write out game time on events and remove pre/post-match events we don't need.
                this.matchStartLineNumber = this.matchStartEvent!.lineNumber;
                if (!this.matchEndEvent) {
                    this.matchEndEvent = this.lastEvent;
                }
                this.matchEndLineNumber = this.matchEndEvent!.lineNumber;
                break;
            default:
                throw "Unexpected phase";
        }
    }

    phaseEnd(phase: EventHandlingPhase, roundState: RoundState): void {
        switch (phase) {
            case EventHandlingPhase.Initial:
                break;
            case EventHandlingPhase.EarlyFixups:
                roundState.roundEndTimeInGameSeconds = this.matchEndEvent!.gameTimeAsSeconds!
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
                this.lastEvent = event;
                return HandlerRequest.None;
            case EventHandlingPhase.EarlyFixups:
                // Will be negative if a pre-match event.
                event.gameTimeAsSeconds = Math.round((event.timestamp.getTime() - this.matchStartEvent!.timestamp.getTime()) / 1000);

                // If there's a clock adjustment (e.g. via an NTP update or a daylight saving time change), adjust this and future events
                // to make the clock monotonically increasing and without large (>~1 hour) gaps.
                if (!this.previousEventGameTimeAsSeconds) {
                    this.previousEventGameTimeAsSeconds = event.gameTimeAsSeconds;
                }
                else {
                    event.gameTimeAsSeconds += this.eventGameTimeAsSecondsAdjustment;
                    if (event.gameTimeAsSeconds < this.previousEventGameTimeAsSeconds || // Clock went backwards; shift events forward.
                        event.gameTimeAsSeconds > (this.previousEventGameTimeAsSeconds + 3500) // Likely DST adjustment
                        ) {
                        this.eventGameTimeAsSecondsAdjustment = this.previousEventGameTimeAsSeconds - event.gameTimeAsSeconds;
                        console.log(`Time adjustment required starting on line ${event.lineNumber}: ${this.eventGameTimeAsSecondsAdjustment}`);
                        event.gameTimeAsSeconds += this.eventGameTimeAsSecondsAdjustment;
                    }
                }
                this.previousEventGameTimeAsSeconds = event.gameTimeAsSeconds;

                if (event.lineNumber < this.matchStartLineNumber! || (this.matchStartLineNumber !== undefined && event.lineNumber > this.matchEndLineNumber!)) {
                    if (eventsNotToCull.indexOf(event.eventType) === -1) {
                        return HandlerRequest.RemoveEvent;
                    }
                    else if (event.gameTimeAsSeconds === 0) {
                        // Also cull suicides and damage due to prematch end.
                        if (event.eventType === EventType.PlayerCommitSuicide ||
                            event.eventType === EventType.PlayerDamage) {
                            return HandlerRequest.RemoveEvent;
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