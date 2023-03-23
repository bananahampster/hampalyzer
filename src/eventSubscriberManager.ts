import { Event } from './parser.js';
import { RoundState } from './roundState.js';

export enum EventHandlingPhase {
    Phase0,
    Phase1,
}

export interface EventSubscriber {
    handleEvent(event: Event, phase: EventHandlingPhase, roundState: RoundState): void;
}

export type SubscriberList = Record<string, { subscriber: EventSubscriber, phases: EventHandlingPhase[] }>;
export class EventSubscriberManager {
    private eventSubscribersByPhase: Record<EventHandlingPhase, EventSubscriber[]>;
    private roundState: RoundState;

    constructor(subscribers: SubscriberList, roundState: RoundState) {
        let phaseHandlers = {};
        this.eventSubscribersByPhase = {
            [EventHandlingPhase.Phase0]: [],
            [EventHandlingPhase.Phase1]: [],
        };
        
        for (const [name, subscriber] of Object.entries(subscribers)) {
            for (const phase of subscriber.phases) {
                this.eventSubscribersByPhase[phase].push(subscriber.subscriber);
            }
        }

        this.roundState = roundState;
    }

    public handleEvents(events: Event[]) {
        // Repeat the delivery of all events for every phase.
        Object.keys(EventHandlingPhase).filter((key) => isNaN(Number(key))).map((phaseKey) => {
            const phase = EventHandlingPhase[phaseKey];
            // Pass one event at a time to all handlers in this phase.
            events.forEach((event) => {
                this.eventSubscribersByPhase[phase].forEach((subscriber: EventSubscriber) => {
                    try {
                        subscriber.handleEvent(event, phase, this.roundState);
                    }
                    catch (originalError: any) {
                        const error = new Error(`[subscriber=${subscriber.constructor.name}, phase=${EventHandlingPhase[phase]}] failed (error=${originalError}) when handling line ${event.lineNumber}: ${event.rawLine}`);
                        error.stack = originalError.stack;
                        throw error;
                    }
                });
            });
        });
    }
}