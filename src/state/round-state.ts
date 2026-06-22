import { EventHandlingPhase, EventSubscriber, HandlerRequest, SubscriberList } from "./event-subscriber-manager.js";
import { PlayerTeamTracker } from "./player-team-tracker.js";
import { PreAndPostMatchCuller } from "./pre-and-post-match-culler.js";
import { FlagMovementTracker } from "./flag-movement-tracker.js";
import { WhileConcedTracker } from "./while-conced-tracker.js";
import Player from "../models/player.js";
import { TeamColor } from "../models/types.js";
import { ClassTracker } from "./class-tracker.js";


// This class accumulates state via parsed events being handled by different subscribers/state machines.
export class RoundState {
    // The players seen throughout the round.
    private playerTeamTracker: PlayerTeamTracker;
    private classTracker: ClassTracker;
    private flagMovementTracker: FlagMovementTracker;
    public roundEndTimeInGameSeconds: number = 0;

    constructor() {
        this.playerTeamTracker = new PlayerTeamTracker();
        this.flagMovementTracker = new FlagMovementTracker();
        this.classTracker = new ClassTracker();
    }

    public getEventSubscribers(): SubscriberList {
        return {
            preAndPostMatchHandler: { subscriber: new PreAndPostMatchCuller(), phases: [EventHandlingPhase.Initial, EventHandlingPhase.EarlyFixups] },
            classHandler: { subscriber: this.classTracker, phases: [EventHandlingPhase.AfterGameTimeEpochEstablished] },
            playerTeamStateHandler: { subscriber: this.playerTeamTracker, phases: [EventHandlingPhase.AfterGameTimeEpochEstablished] },
            flagMovementHandler: { subscriber: this.flagMovementTracker, phases: [EventHandlingPhase.Main] },
            whileConcedHandler: { subscriber: new WhileConcedTracker(), phases: [EventHandlingPhase.Main] },
        };
    }

    public ensurePlayer(steamID: string, name?: string, playerID?: number, team?: TeamColor): Player | undefined {
        return this.playerTeamTracker.ensurePlayer(steamID, name, playerID, team);
    }

    get currentTeams() {
        return this.playerTeamTracker.currentTeams;
    }
    get players() {
        return this.playerTeamTracker.players;
    }
    get score() {
        return this.flagMovementTracker.score;
    }
    get teamFlagMovements() {
        return this.flagMovementTracker.teamFlagMovements;
    }
}
