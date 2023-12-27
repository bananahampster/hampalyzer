import { EventHandlingPhase, EventSubscriber, HandlerRequest } from './eventSubscriberManager.js'
import { RoundState } from './roundState.js'
import { Event } from './parser.js';
import EventType from './eventType.js';
import { ParsingError } from './constants.js';

export class ClassTracker extends EventSubscriber {
    public phaseStart(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.AfterGameTimeEpochEstablished)
            throw new ParsingError({
                name: 'LOGIC_FAILURE',
                message: "Unexpected phase"
            });
    }

    public phaseEnd(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.AfterGameTimeEpochEstablished)
            throw new ParsingError({
                name: 'LOGIC_FAILURE',
                message: "Unexpected phase"
            });
    }

    public handleEvent(event: Event, _phase: EventHandlingPhase, _roundState: RoundState): HandlerRequest {
        switch (event.eventType) {
            case EventType.PlayerChangeRole:
                const playerClass = event?.data?.class;
                if (playerClass != null) {
                    event!.playerFrom!.recordClassStartTime(playerClass, event.gameTimeAsSeconds);
                }
                break;
            case EventType.PlayerJoinTeam:
            case EventType.PlayerLeftServer:
            // @ts-expect-error: explicit fall through
            case EventType.PlayerKicked:
                event!.playerFrom!.recordClassEndTime(event.gameTimeAsSeconds);
                // fall through
            default:
                this.setPlayerClassOnEvent(event, 'from');
                this.setPlayerClassOnEvent(event, 'to');
                break;
        }

        return HandlerRequest.None;
    }

    private setPlayerClassOnEvent(event: Event, playerDirection: 'from' | 'to'): void {
        const player = playerDirection === 'from' ? event.playerFrom : event.playerTo;

        if (player) {
            const currentClass = player.currentClass;
            if (currentClass) {
                switch (playerDirection) {
                    case 'from':
                        event.playerFromClass = currentClass;
                        return;
                    case 'to':
                        event.playerToClass = currentClass;
                        return;
                    default:
                        throw new ParsingError({
                            name: 'LOGIC_FAILURE',
                            message: 'unknown playerDirection'
                        });
                }
            }
        }
    }
}
