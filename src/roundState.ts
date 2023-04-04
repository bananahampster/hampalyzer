import { EventHandlingPhase, EventSubscriber, HandlerRequest, SubscriberList } from "./eventSubscriberManager.js";
import { PlayerTeamTracker } from "./playerTeamTracker.js";
import { PreAndPostMatchCuller } from "./preAndPostMatchCuller.js";
import { FlagMovementTracker } from "./flagMovementTracker.js";
import { WhileConcedTracker } from "./whileConcedTracker.js";
import { Event } from "./parser.js";
import Player from "./player.js";
import { TeamColor } from "./constants.js";
import { ClassTracker } from "./classTracker.js";


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
            playerTeamStateHandler: { subscriber: this.playerTeamTracker, phases: [EventHandlingPhase.Initial] },
            classHandler: { subscriber: this.classTracker, phases: [EventHandlingPhase.Initial] },
            preAndPostMatchHandler: { subscriber: new PreAndPostMatchCuller(), phases: [EventHandlingPhase.Initial, EventHandlingPhase.EarlyFixups] },
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
    get teams() {
        return this.playerTeamTracker.teams;
    }
    get players() {
        return this.playerTeamTracker.players;
    }
    get classes() {
        return this.classTracker.classes;
    }
    get scoreAndFlagMovements() {
        return this.flagMovementTracker.getScoreAndFlagMovements(this);
    }
}
