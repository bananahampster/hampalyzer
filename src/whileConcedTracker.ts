import { PlayerClass } from "./constants.js";
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import EventType from "./eventType.js";
import { Event } from "./parser.js";
import Player from "./player.js";
import { RoundState } from "./roundState.js";

export class WhileConcedTracker extends EventSubscriber {

    private whoIsConced: Record<Player["steamID"], number | null> = {};

    public phaseStart(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Main)
            throw "Unexpected phase";
    }

    public phaseEnd(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Main)
            throw "Unexpected phase";
    }

    public handleEvent(event: Event, _phase: EventHandlingPhase, _roundState: RoundState): HandlerRequest {
        const playerToId: string | null = event.playerTo ? event.playerTo.steamID : null;

        switch (event.eventType) {
            case EventType.PlayerCommitSuicide:
            case EventType.PlayerLeftServer:
            case EventType.PlayerJoinTeam:
            case EventType.PlayerFraggedPlayer:
            case EventType.PlayerKicked:
                if (playerToId != null) {
                    this.whoIsConced[playerToId] = null;
                }
                break;
            default:
                break;
        }
        // if this event has a playerFrom event,
        // mark it `whileConced` if within conc effect duration
        if (event.playerFrom != null) {
            // TODO this isn't populated by this point; add stateTracker for this
            const playerIsMedic = event.playerToClass === PlayerClass.Medic;

            const lastConced = this.whoIsConced[event.playerFrom.steamID];
            if (lastConced != null && !isNaN(lastConced) &&
                (event.gameTimeAsSeconds - lastConced) <= (playerIsMedic ? 5 : 10)) {

                event.whileConced = true;
            }
        }

        // Update the conc status _after_ the logic above to ensure the `whileConced`
        // marking on the event is based on prior concs rather than this one.
        if (event.eventType === EventType.PlayerConced) {
            // keep track of who's conced, based on time;
            // assumes preAndPostMatchCuller has already calcuated `event.gameTimeAsSeconds`
            if (playerToId != null) {
                this.whoIsConced[playerToId] = event.gameTimeAsSeconds;
            }
        }

        return HandlerRequest.None;
    }
}
