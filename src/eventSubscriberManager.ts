import { ParsingError } from './constants.js';
import { Event } from './parser.js';
import { RoundState } from './roundState.js';

export enum EventHandlingPhase {
    Initial,
    EarlyFixups,
    AfterGameTimeEpochEstablished,
    Main,
    PostMain
}

export enum HandlerRequest {
    None,
    RemoveEvent
}

export abstract class EventSubscriber {
    /**  Called before handleEvent calls begin for the phase.. */
    abstract phaseStart(phase: EventHandlingPhase, roundState: RoundState): void;
    /** Called after handleEvent calls end for the phase. */
    abstract phaseEnd(phase: EventHandlingPhase, roundState: RoundState): void;
    /** Every event is provided one at a time (in order) to this method during each phase this subscriber is registered for. */
    abstract handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest;
}

export type SubscriberList = Record<string, { subscriber: EventSubscriber, phases: EventHandlingPhase[] }>;
export class EventSubscriberManager {
    private eventSubscribersByPhase: Record<EventHandlingPhase, EventSubscriber[]>;
    private roundState: RoundState;

    constructor(subscribers: SubscriberList, roundState: RoundState) {
        let phaseHandlers = {};
        this.eventSubscribersByPhase = {
            [EventHandlingPhase.Initial]: [],
            [EventHandlingPhase.EarlyFixups]: [],
            [EventHandlingPhase.AfterGameTimeEpochEstablished]: [],
            [EventHandlingPhase.Main]: [],
            [EventHandlingPhase.PostMain]: [],
        };

        for (const [name, subscriber] of Object.entries(subscribers)) {
            for (const phase of subscriber.phases) {
                this.eventSubscribersByPhase[phase].push(subscriber.subscriber);
            }
        }

        this.roundState = roundState;
    }

    public handleEvents(events: Event[]) {
        // Repeat the delivery of events for each phase.
        Object.keys(EventHandlingPhase).filter((key) => isNaN(Number(key))).map((phaseKey) => {
            const phase = EventHandlingPhase[phaseKey];

            this.eventSubscribersByPhase[phase].forEach((subscriber: EventSubscriber) => {
                subscriber.phaseStart(phase, this.roundState);
            });

            // Pass each event into all subscribers for the phase.
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                let shouldRemoveEvent = false;
                this.eventSubscribersByPhase[phase].forEach((subscriber: EventSubscriber) => {
                    try {
                        const request = subscriber.handleEvent(event, phase, this.roundState);
                        if (request === HandlerRequest.RemoveEvent) {
                            shouldRemoveEvent = true;
                        }
                    }
                    catch (error: any) {
                        console.error(`[subscriber=${subscriber.constructor.name}, phase=${EventHandlingPhase[phase]}] failed (error=${error.message}) when handling line ${event.lineNumber}: ${event.rawLine}`);
                        
                        throw new ParsingError({
                            name: 'LOGIC_FAILURE',
                            message: error,
                        });
                    }
                });
                if (shouldRemoveEvent) {
                    events.splice(i, 1);
                    --i;
                }
            }

            this.eventSubscribersByPhase[phase].forEach((subscriber: EventSubscriber) => {
                subscriber.phaseEnd(phase, this.roundState);
            });

        });
    }
}