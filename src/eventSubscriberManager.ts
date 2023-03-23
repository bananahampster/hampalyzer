import { Event } from './parser.js';
import { RoundState } from './roundState.js';

export enum EventHandlingPhase {
    Initial,
    EarlyFixups,
    Main
}

export enum HandlerRequest {
    None,
    RemoveEvent
}

export interface EventSubscriber {
    phaseStart(phase: EventHandlingPhase, roundState: RoundState): void;
    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): HandlerRequest;
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
            [EventHandlingPhase.Main]: [],
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
            
            // Notify subscribers the phase is starting.
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
                    catch (originalError: any) {
                        const error = new Error(`[subscriber=${subscriber.constructor.name}, phase=${EventHandlingPhase[phase]}] failed (error=${originalError}) when handling line ${event.lineNumber}: ${event.rawLine}`);
                        error.stack = originalError.stack;
                        throw error;
                    }
                });
                if (shouldRemoveEvent) {
                    events.splice(i, 1);
                    --i;
                }
            }
        });
    }
}