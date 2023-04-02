import { EventHandlingPhase, EventSubscriber, HandlerRequest } from './eventSubscriberManager.js'
import { RoundState } from './roundState.js'
import { Event } from './parser.js';
import Player from './player.js';
import { ClassTime, PlayerClass } from './constants.js';
import EventType from './eventType.js';

type ClassTimeTracker = Omit<ClassTime, 'time'>;
export type PlayerClasses = Record<Player['steamID'], ClassTimeTracker[]>;

export class ClassTracker extends EventSubscriber {
    private playerClasses: PlayerClasses = {};

    public phaseStart(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Initial)
            throw "Unexpected phase";
    }

    public phaseEnd(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Initial)
            throw "Unexpected phase";
    }

    public handleEvent(event: Event, _phase: EventHandlingPhase, _roundState: RoundState): HandlerRequest {
        switch (event.eventType) {
            case EventType.PlayerChangeRole:
                const playerId = event!.playerFrom!.steamID;
                if (!this.playerClasses[playerId]) {
                    this.playerClasses[playerId] = [];
                }

                const playerClass = event?.data?.class;
                if (playerClass != null) {
                    const playerClasses = this.playerClasses[playerId];
                    const classLength = playerClasses.length;

                    // set end of previous classTime, if available
                    if (classLength !== 0) {
                        playerClasses[playerClasses.length - 1].endLineNumber = event.lineNumber - 1;
                    }

                    playerClasses.push({
                        class: playerClass,
                        classAsString: PlayerClass.outputClass(playerClass),
                        startLineNumber: event.lineNumber,
                        endLineNumber: null,
                    });

                }
                break;

            default:
                this.setPlayerClassOnEvent(event, 'from');
                this.setPlayerClassOnEvent(event, 'to');
                break;
        }

        return HandlerRequest.None;
    }

    public get classes(): PlayerClasses {
        return this.playerClasses;
    }

    private setPlayerClassOnEvent(event: Event, playerDirection: 'from' | 'to'): void {
        const player = playerDirection === 'from' ? event.playerFrom : event.playerTo;
        const playerId = player?.steamID;

        if (playerId != null) {
            const playerClasses = this.playerClasses?.[playerId];
            if (playerClasses) {
                switch (playerDirection) {
                    case 'from':
                        event.playerFromClass = playerClasses[playerClasses.length - 1].class;
                        return;
                    case 'to':
                        event.playerToClass = playerClasses[playerClasses.length - 1].class;
                        return;
                    default:
                        throw 'unknown playerDirection';
                }
            }
        }
    }
}
