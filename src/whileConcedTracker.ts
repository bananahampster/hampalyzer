import { PlayerClass } from "./constants.js";
import { EventSubscriber, EventHandlingPhase, HandlerRequest } from "./eventSubscriberManager.js";
import EventType from "./eventType.js";
import { Event } from "./parser.js";
import Player from "./player.js";
import { RoundState } from "./roundState.js";

export class WhileConcedTracker implements EventSubscriber {

    private whosConced: Record<Player["steamID"], number | null> = {};

    public phaseStart(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Main)
            throw "Unexpected phase";
    }

    public phaseEnd(phase: EventHandlingPhase, _roundState: RoundState): void {
        if (phase !== EventHandlingPhase.Main)
            throw "Unexpected phase";
    }

    public handleEvent(event: Event, _phase: EventHandlingPhase, _roundState: RoundState): HandlerRequest {
        const fromPlayerId = event.playerTo?.steamID;

        switch (event.eventType) {
            case EventType.PlayerConced:
                // keep track of who's conced, based on time;
                // assumes preAndPostMatchCuller has already calcuated `event.gameTimeAsSeconds`
                if (fromPlayerId != null) {
                    this.whosConced[fromPlayerId] = event.gameTimeAsSeconds;
                }
                break;
            case EventType.PlayerFraggedPlayer:
            case EventType.PlayerCommitSuicide:
            case EventType.PlayerLeftServer:
            case EventType.PlayerJoinTeam:
            case EventType.PlayerKicked:
                if (fromPlayerId != null) {
                    this.whosConced[fromPlayerId] = null;
                }
            default:
                // if this event has a playerFrom event,
                // mark it `whileConced` if within conc effect duration
                if (event.playerFrom != null) {
                    // TODO this isn't populated by this point; add stateTracker for this
                    const playerIsMedic = event.playerFromClass === PlayerClass.Medic;

                    const lastConced = this.whosConced[event.playerFrom.steamID];
                    if (lastConced != null && !isNaN(lastConced) &&
                        (event.gameTimeAsSeconds - lastConced) <= (playerIsMedic ? 5 : 10)) {

                        event.whileConced = true;
                    }
                }
                break;
        }

        return HandlerRequest.None;
    }
}
