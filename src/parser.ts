import * as fs from 'fs';
import EventType from './eventType.js';
import Player from './player.js';
import PlayerList from './playerList.js';
import { EventHandlingPhase, EventSubscriber, EventSubscriberManager } from './eventSubscriberManager.js';
import { PlayerTeamTracker } from './playerTeamTracker.js';
import { OutputStats, TeamComposition, PlayerClass, TeamColor, Weapon, TeamStatsComparison, OutputPlayer } from './constants.js';
import { MapLocation } from './mapLocation.js';
import { RoundState } from './roundState.js';
import ParserUtils from './parserUtils.js';
import { FileCompression } from './fileCompression.js';

type RoundStats = (OutputStats | undefined)[];
export interface ParsedStats {
    stats: RoundStats;
    players: TeamComposition<OutputPlayer>;
    parsing_errors: (string[] | undefined)[];
    comparison?: TeamStatsComparison;
}

export class Parser {
    private rounds: RoundParser[] = [];

    constructor(...filenames: string[]) {
        // TODO: should probably check if the files exist here
        this.rounds = filenames.map(filename => new RoundParser(filename));
     }

    public get stats(): RoundStats {
        return this.rounds.map(round => round.stats);
    }

    public async parseRounds(): Promise<ParsedStats | undefined> {
        return Promise.all(this.rounds.map(round => round.parseFile()))
            .then(() => {
                // TODO: be smarter about ensuring team composition matches, map matches, etc. between rounds
                const stats = this.rounds.map(round => round.stats);

                if (!this.rounds[0]!.playerList) {
                    // The log was bogus or failed to parse. Nothing more we can do.
                    return undefined;
                }

                let comparison: TeamStatsComparison | undefined;
                let teamComp: TeamComposition<OutputPlayer> = ParserUtils.playerListToOutput(this.rounds[0]!.playerList!);
                if (this.rounds.length === 2) {
                    comparison = ParserUtils.generateTeamRoleComparison(stats as [OutputStats, OutputStats]);
                    teamComp = ParserUtils.generateTeamComposition(this.rounds) || teamComp;
                }

                // calculate game-wide rankings (like MVP?); this'll side-effect stats
                ParserUtils.setGameAwards(teamComp, stats);

                return <ParsedStats> {
                    players: teamComp,
                    stats,
                    parsing_errors: stats.map(round => round?.parsing_errors),
                    comparison,
                };
            });
    }
}

export class RoundParser {
    private rawLogData: string = "";
    private roundState = new RoundState();
    private players: PlayerList = new PlayerList();

    private allEvents: string[] = [];
    public events: Event[] = [];

    private summarizedStats: OutputStats | undefined;

    private parsingErrors: string[] = [];

    constructor(private filename: string) {
        // should probably check if the file exists here
    }

    public async parseFile(): Promise<void> {
        this.rawLogData = await FileCompression.getDecompressedContents(this.filename);
        return this.parseData();
    }

    public data(): string {
        return this.rawLogData;
    }

    public get stats(): OutputStats | undefined {
        return this.summarizedStats;
    }

    public get playerList(): PlayerList | undefined {
        return this.players;
    }

    private parseData(): void {
        this.allEvents = this.rawLogData.split("\n");

        this.allEvents.forEach((event, lineNumber) => {
            const newEvent = Event.createEvent(lineNumber + 1, event, this.roundState);
            if (newEvent) {
                if (typeof newEvent === 'string') {
                    this.parsingErrors.push(newEvent);
                }
                else {
                    this.events.push(newEvent);
                }
            }
        });

        //
        // Accumulate state by progressively evaluating events. Multiple phases are supported
        // to enable ordering dependencies between event subscribers.
        //
        const eventSubscriberManager = new EventSubscriberManager(this.roundState.getEventSubscribers(), this.roundState);
        try {
            eventSubscriberManager.handleEvents(this.events);
        }
        catch (error: any) {
            console.error(error.message);
            throw error;
        }


        this.players = ParserUtils.getFilteredPlayers(this.roundState);
        const score = this.roundState.score;
        for (const team in this.roundState.players.teams) {
            const teamPlayers = this.players.teams[team];
            if (teamPlayers) {
                const teamScore = score[team];
                console.log(`Team ${team} (score ${teamScore}) has ${teamPlayers.length} players: ${teamPlayers.join(', ')}.`);
            }
        }

        const playerStats = ParserUtils.generatePlayerStats(this.events);
        this.summarizedStats = ParserUtils.generateOutputStats(this.roundState, this.events, playerStats, this.players, this.filename);
        this.summarizedStats.parsing_errors = this.parsingErrors;
    }

    private trimPreAndPostMatchEvents() {
        const matchStartEvent = this.events.find(event => event.eventType === EventType.PrematchEnd) || this.events[0];
        const matchEndEvent = this.events.find(event => event.eventType === EventType.TeamScore) || this.events.at(-1)!;

        const matchStartLineNumber = matchStartEvent.lineNumber;
        const matchEndLineNumber = matchEndEvent.lineNumber;
        if (matchStartEvent) {
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

            // iterate through events, but skip culling chat, role, and team messages
            for (let i = 0; i < this.events.length; i++) {
                const e = this.events[i];

                // Will be negative if a pre-match event (see eventsNotToCull).
                e.gameTimeAsSeconds = Math.round((e.timestamp.getTime() - matchStartEvent.timestamp.getTime()) / 1000);

                if (e.lineNumber < matchStartLineNumber || e.lineNumber > matchEndLineNumber) {
                    if (eventsNotToCull.indexOf(e.eventType) === -1) {
                        this.events.splice(i, 1);
                        i--;
                    }
                }
            }

            // also cull suicides/dmg due to prematch end
            const prematchEndIndex = this.events.findIndex(event => event.lineNumber === matchStartLineNumber);
            let i = prematchEndIndex + 1;
            while (i < this.events.length && this.events[i].gameTimeAsSeconds === 0) {
                const currentEvent = this.events[i];
                if (currentEvent.eventType === EventType.PlayerCommitSuicide ||
                    currentEvent.eventType === EventType.PlayerDamage) {
                    this.events.splice(i, 1);
                }
                else
                    i++;
            }
        }
    }
}

export interface EventCreationOptions {
    eventType: EventType;
    rawLine: string;
    lineNumber: number;
    timestamp: Date;
    data?: ExtraData;
    playerFrom?: Player;
    playerFromClass?: PlayerClass;
    playerTo?: Player;
    playerToClass?: PlayerClass;
    withWeapon?: Weapon;
}

export class Event {
    // core required data
    public eventType: EventType;
    public rawLine: string;
    public lineNumber: number;
    public timestamp: Date;

    // filled in by state trackers as required data for further parsing
    public gameTimeAsSeconds: number; // filled in "EarlyFixups" phase
    public whileConced: boolean; // filled in "Main" phase

    public data?: ExtraData;
    public playerFrom?: Player;
    public playerFromClass?: PlayerClass;
    public playerTo?: Player;
    public playerToClass?: PlayerClass;
    public withWeapon?: Weapon;
    public playerFromWasCarryingFlag: boolean;
    public playerToWasCarryingFlag: boolean;

    constructor(options: EventCreationOptions) {
        // required fields
        this.eventType = options.eventType;
        this.rawLine = options.rawLine;
        this.lineNumber = options.lineNumber;
        this.timestamp = options.timestamp;

        // optional fields
        this.data = options.data;
        this.playerFrom = options.playerFrom;
        this.playerFromClass = options.playerFromClass;
        this.playerTo = options.playerTo;
        this.playerToClass = options.playerToClass;
        this.withWeapon = options.withWeapon;

        // these items are filled in later
        this.gameTimeAsSeconds = -1;
        this.whileConced = false;
        this.playerFromWasCarryingFlag = false;
        this.playerToWasCarryingFlag = false;
    }

    // Breaks apart a line on spaces while preserving quoted substrings.
    // Quoted substrings are returned without the quotes.
    private static explodeLine(line: string): string[] {
        let parts = [] as string[];

        let re = /[^\s"]+|"([^"]*)"/g;
        let match;
        do {
            match = re.exec(line);
            if (match !== null) {
                // If index 1 exists, there was a quoted string; return the capture between the quotes.
                // If it doesn't, the entire match in index 0 contains the unquoted string.
                parts.push(match[1] ? match [1] : match[0]);
            }
        } while (match !== null);

        return parts;
    }

    public static createEvent(lineNumber: number, line: string, roundState: RoundState): Event | string | undefined {
        let eventType: EventType | undefined;
        let timestamp: Date | undefined;

        let withWeapon: Weapon | undefined;
        let playerFrom: Player | undefined;
        let playerTo: Player | undefined;
        let data: ExtraData = {};

        // a valid log line must start with 'L'
        if (line[0] === 'L') {
            // parse date
            timestamp = new Date(line.substr(2, 21).replace(" - ", " "));

            // figure out the type of event
            const lineData = line.substr(25);

            // short-circuit HLTV/Metamod for now (TODO)
            if (lineData.indexOf('><HLTV><') !== -1 || lineData.indexOf('[META]') !== -1)
                return;

            // Ignore custom damage events for world damage which is in the form of 'server_name<0><><>" damaged "player<id><STEAM_'.
            if (lineData.indexOf("<0><><>\" damaged \"") > -1)
                return;

            // Split the line context into three objects: the player the event originated from, the player it impacted (if any),
            // and the other strings in the line.
            const lineDataParts = this.explodeLine(lineData);

            // if lineDataParts is empty, this log may be incomplete (stopped writing file mid-line). abort
            if (lineDataParts.length === 0)
                return;

            let playerRE = /(.*)<([0-9]+)><STEAM_([0-9:]+)><(.*)>/i;
            const fromPlayerDataParts = lineDataParts[0].match(playerRE);
            let otherPlayerDataParts = null as RegExpMatchArray | null;
            let nonPlayerDataParts = [] as string[];
            // Skip over the "from player data" if it existed.
            for (let i = (fromPlayerDataParts != null ? 1 : 0); i < lineDataParts.length; i++) {
                if (otherPlayerDataParts === null) {
                    var potentialOtherPlayerDataParts = lineDataParts[i].match(playerRE);
                    if (potentialOtherPlayerDataParts !== null) {
                        otherPlayerDataParts = potentialOtherPlayerDataParts;
                        continue;
                    }
                }
                nonPlayerDataParts.push(lineDataParts[i]);
            }

            // Wrap in a try/catch so we can log the line number for a failed parse.
            try {
                // if there is a player match, we'll have multiple parts
                if (fromPlayerDataParts !== null) {
                    const playerName = fromPlayerDataParts[1];
                    const playerID = Number(fromPlayerDataParts[2]);
                    const playerSteamID = fromPlayerDataParts[3];
                    const playerFromTeam = this.parseTeam(fromPlayerDataParts[4]);

                    playerFrom = roundState.ensurePlayer(playerSteamID, playerName, playerID, playerFromTeam);

                    if (otherPlayerDataParts != null) { // Two players were affected.
                        const otherPlayerName = otherPlayerDataParts[1];
                        const otherPlayerID = Number(otherPlayerDataParts[2]);
                        const otherPlayerSteamID = otherPlayerDataParts[3];
                        const playerToTeam = this.parseTeam(otherPlayerDataParts[4]);

                        playerTo = roundState.ensurePlayer(otherPlayerSteamID, otherPlayerName, otherPlayerID, playerToTeam);
                        // do a switch based on the statement
                        switch (nonPlayerDataParts[0]) {
                            case "killed":
                                if (nonPlayerDataParts[1] === "with") {
                                    eventType = EventType.PlayerFraggedPlayer;
                                    withWeapon = Event.parseWeapon(nonPlayerDataParts[2]);
                                } else
                                    throw "unknown 'killed' event: " + line;
                                break;
                            case "triggered":
                                if (nonPlayerDataParts[1].startsWith("airshot")) {
                                    eventType = EventType.PlayerHitAirshot;
                                    withWeapon = nonPlayerDataParts[1].indexOf('gl') === 0 ? Weapon.BluePipe : Weapon.Rocket;
                                    // Example: player_from triggered "airshot_rpg" against player_to from a distance of 2 meters
                                    // Non-player indices:      0           1          2                3  4     5    6  7 8
                                    data.value = nonPlayerDataParts[7];

                                } else if (nonPlayerDataParts[1] === "Concussion_Grenade") {
                                    eventType = EventType.PlayerConced;

                                } else if (nonPlayerDataParts[1] === "Sentry_Destroyed") {
                                    eventType = EventType.PlayerFraggedGun;
                                    withWeapon = Event.parseWeapon(nonPlayerDataParts[4]);

                                } else if (nonPlayerDataParts[1] === "Dispenser_Destroyed") {
                                    eventType = EventType.PlayerFraggedDispenser;
                                    withWeapon = Event.parseWeapon(nonPlayerDataParts[4]);

                                } else if (nonPlayerDataParts[1] ==="Teleporter_Entrance_Destroyed" || nonPlayerDataParts[1] === "Teleporter_Exit_Destroyed") {
                                    eventType = EventType.PlayerFraggedTeleporter;
                                    withWeapon = Event.parseWeapon(nonPlayerDataParts[4]);

                                } else if (nonPlayerDataParts[1].startsWith("Sentry_Upgrade")) {
                                    eventType = EventType.PlayerUpgradedOtherGun;
                                    data.level = Number(nonPlayerDataParts[1].at(-1));

                                } else if (nonPlayerDataParts[1] === `Sentry_Repair`) {
                                    eventType = EventType.PlayerRepairedBuilding;
                                    data.building = Event.parseWeapon("sentrygun");

                                } else if (nonPlayerDataParts[1] === "Teleporter_Entrance_Repaired" || nonPlayerDataParts[1] === "Teleporter_Exit_Repaired") {
                                    eventType = EventType.PlayerRepairedBuilding;
                                    data.building = Event.parseWeapon("teleporter");

                                } else if (nonPlayerDataParts[1] === "Detpack_Disarmed") {
                                    eventType = EventType.PlayerDetpackDisarm;

                                } else if (nonPlayerDataParts[1] === "Medic_Heal") {
                                    eventType = EventType.PlayerHeal;

                                } else if (nonPlayerDataParts[1] === "Caltrop_Grenade") {
                                    eventType = EventType.PlayerCaltroppedPlayer;

                                } else if (nonPlayerDataParts[1] === "Spy_Tranq") {
                                    eventType = EventType.PlayerTranqedPlayer;

                                } else if (nonPlayerDataParts[1] === "Hallucination_Grenade") {
                                    eventType = EventType.PlayerHallucinatedPlayer;

                                } else if (nonPlayerDataParts[1] === "Medic_Infection") {
                                    eventType = EventType.PlayerInfectedPlayer;

                                } else if (nonPlayerDataParts[1] === "Passed_On_Infection") {
                                    eventType = EventType.PlayerPassedInfection;

                                } else if (nonPlayerDataParts[1] === "Medic_Cured_Infection") {
                                    eventType = EventType.PlayerCuredInfection;

                                } else if (nonPlayerDataParts[1] === "Discovered_Spy") {
                                    eventType = EventType.PlayerRevealedSpy;

                                } else if (nonPlayerDataParts[1] === "Medic_Doused_Fire") {
                                    eventType = EventType.PlayerDousedFire;

                                } else if (nonPlayerDataParts[1] === "Medic_Cured_Hallucinations") {
                                    eventType = EventType.PlayerCuredHallucinations;

                                } else if (nonPlayerDataParts[1] === "Medic_Cured_Tranquilisation") {
                                    eventType = EventType.PlayerCuredInfection;

                                } else {
                                    throw "unknown two-person trigger event";
                                }
                                break;
                            case "damaged": // For servers with custom damage stats mod.
                                const damageAsNumber = Number(nonPlayerDataParts[2]); // damaged for <value>
                                // Pregame end shows large self-damage values.
                                if (damageAsNumber >= 10000)
                                    return;

                                eventType = EventType.PlayerDamage;
                                data.value = nonPlayerDataParts[2];
                                break;
                            default:
                                throw "unknown multi-player event";
                        }
                    } else {
                        switch (nonPlayerDataParts[0]) {
                            case "say_team":
                            case "say":
                                // TODO: does say_team always create an extra new-line?
                                eventType = nonPlayerDataParts[0] === "say_team" ? EventType.PlayerMM2 : EventType.PlayerMM1;
                                data.value = nonPlayerDataParts[1];
                                break;
                            case "joined":
                                eventType = EventType.PlayerJoinTeam;
                                playerTo = playerFrom;
                                data.team = Event.parseTeam(nonPlayerDataParts[2]);
                                break;
                            case "entered":
                                eventType = EventType.PlayerJoinServer;
                                break;
                            case "connected,":
                            case "STEAM":
                                // we don't care about STEAM validation messages or initial connection (above "entered" means client is alive)
                                return;
                            case "disconnected":
                            case "disconnected\r":
                                eventType = EventType.PlayerLeftServer;
                                playerTo = playerFrom;
                                break;
                            case "changed":
                                if (nonPlayerDataParts[1] === "name") {
                                    eventType = EventType.PlayerChangedName;
                                    data.value = nonPlayerDataParts[3];
                                }
                                else if (nonPlayerDataParts[1] === "role") {
                                    eventType = EventType.PlayerChangeRole;
                                    data.class = Event.parseClass(nonPlayerDataParts[3]);
                                }

                                // TODO: what else comes through here?
                                break;
                            case "committed": // TODO: sometimes this line has extra data
                            /* e.g., L 11/20/2018 - 01:54:42: "phone<59><STEAM_0:0:44791068><Blue>" committed suicide with "trigger_hurt" (world); L 11/20/2018 - 01:46:41: "pheesh-L7<64><STEAM_0:0:64178><Red>" committed suicide with "train" (world); "tomaso<19><STEAM_0:0:7561319><Blue>" committed suicide with "the red team's lasers" (world) */
                                eventType = EventType.PlayerCommitSuicide;
                                playerTo = playerFrom;
                                let weaponString = nonPlayerDataParts[3];
                                if (nonPlayerDataParts.length >= 5 && nonPlayerDataParts[4] === "(world)") {
                                    weaponString += " (world)";
                                }
                                withWeapon = Event.parseWeapon(weaponString);
                                break;
                            case "triggered":
                                switch (nonPlayerDataParts[1]) {
                                    case "info_player_teamspawn":
                                        eventType = EventType.PlayerSpawn;
                                        break;
                                    case "Sentry_Built_Level_1":
                                        eventType = EventType.PlayerBuiltSentryGun;
                                        break;
                                    case "Sentry_Upgrade_Level_2":
                                        eventType = EventType.PlayerUpgradedGun;
                                        data.level = 2;
                                        break;
                                    case "Sentry_Upgrade_Level_3":
                                        eventType = EventType.PlayerUpgradedGun;
                                        data.level = 3;
                                        break;
                                    case "Sentry_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Sentry_Dismantle":
                                        eventType = EventType.PlayerDismantledBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Sentry_Repair":
                                        eventType = EventType.PlayerRepairedBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Built_Dispenser":
                                        eventType = EventType.PlayerBuiltDispenser;
                                        break;
                                    case "Dispenser_Dismantle":
                                        eventType = EventType.PlayerDismantledBuilding;
                                        data.building = Event.parseWeapon("dispenser");
                                        break;
                                    case "Dispenser_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("dispenser");
                                        break;
                                    case "Teleporter_Entrace_Finished":
                                    case "Teleporter_Entrance_Finished":
                                    case "Teleporter_Exit_Finished":
                                        eventType = EventType.PlayerBuiltTeleporter;
                                        data.building = Event.parseWeapon(nonPlayerDataParts[1]);
                                        break;
                                    case "Teleporter_Entrance_Repaired":
                                    case "Teleporter_Exit_Repaired":
                                        eventType = EventType.PlayerRepairedBuilding;
                                        data.building = Event.parseWeapon("teleporter");
                                        break;
                                    case "Teleporter_Entrance_Dismantle":
                                    case "Teleporter_Exit_Dismantle":
                                        eventType = EventType.PlayerDismantledBuilding;
                                        data.building = Event.parseWeapon("teleporter");
                                        break;
                                    case "Teleporter_Exit_Destroyed":
                                    case "Teleporter_Entrance_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("teleporter");
                                        break;
                                    case "Detpack_Set":
                                        eventType = EventType.PlayerDetpackSet;
                                        break;
                                    case "Detpack_Explode":
                                        eventType = EventType.PlayerDetpackExplode;
                                        break;
                                    // coach's airshot plugin (no dmg'd player?)
                                    case "Airshot":
                                    case "A2A Shot":
                                        eventType = EventType.PlayerHitAirshot;
                                        withWeapon = Weapon.Rocket;
                                        break;
                                    // coach's airshot plugin (no dmg'd player?)
                                    case "Bluepipe Airshot":
                                        eventType = EventType.PlayerHitAirshot;
                                        withWeapon = Weapon.BluePipe;
                                        break;
                                    case "dropitems": // custom event for Inhouse
                                        eventType = EventType.PlayerThrewFlag;
                                        break;
                                    case "dropitems_death": // custom event for Inhouse
                                    case "gainitem": // custom event for Inhouse
                                        switch (nonPlayerDataParts[1]) {
                                            case "dropitems_death":
                                                eventType = EventType.PlayerDroppedFlagViaDeathWithLocation;
                                                break;
                                            case "gainitem":
                                                eventType = EventType.PlayerGainedFlagWithLocation;
                                                break;
                                            default:
                                                throw "Unhandled case";
                                        }

                                        // Example: player_from triggered "dropitems_death" with "Blue Flag" at 1 2 3
                                        // Non-player indices:      0           1            2        3      4  5 6 7
                                        switch (nonPlayerDataParts[3]) {
                                            case "Blue Flag":
                                                data.team = TeamColor.Blue;
                                                break;
                                            case "Red Flag":
                                                data.team = TeamColor.Red;
                                                break;
                                            case "Yellow Flag":
                                                data.team = TeamColor.Yellow;
                                                break;
                                            case "Green Flag":
                                                data.team = TeamColor.Green;
                                                break;
                                            default:
                                                throw `Unknown item for ${nonPlayerDataParts[1]}: ${nonPlayerDataParts[3]}`;
                                        }
                                        data.mapLocation = new MapLocation(nonPlayerDataParts[5], nonPlayerDataParts[6], nonPlayerDataParts[7]);
                                        break;
                                    case "goalitem":
                                        if (nonPlayerDataParts.length === 2) {
                                            eventType = EventType.PlayerPickedUpFlag;
                                            data.team = TeamColor.None;
                                        }
                                        else
                                            throw 'unknown player trigger "goalitem"';
                                        break;
                                    case "Blue Flag Plus": // raiden-style c2c entity pickup
                                        eventType = EventType.PlayerPickedUpBonusFlag;
                                        data.team = TeamColor.Blue;
                                        break;
                                    case "Red Flag Plus":
                                        eventType = EventType.PlayerPickedUpBonusFlag;
                                        data.team = TeamColor.Red;
                                        break;
                                    case "Blue Capture Point Extra": // cranked capture after flag-through-the-water
                                        eventType = EventType.PlayerCapturedBonusFlag;
                                        data.team = TeamColor.Blue;
                                        break;
                                    case "Red Capture Point Extra":
                                        eventType = EventType.PlayerCapturedBonusFlag;
                                        data.team = TeamColor.Red;
                                        break;
                                    case "Capture Point":
                                        // TODO: what maps, if any, use this string which contains no team info?
                                        eventType = EventType.PlayerCapturedFlag;
                                        data.team = playerFrom!.team;
                                        break;
                                    case "Blue Flag": // proton_l
                                    case "Blue_Flag":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Blue;
                                        break;
                                    case "Red Flag":
                                    case "Red_Flag":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Red;
                                        break;
                                    case "Blue Cap":
                                    case "Blue_Cap":
                                    case "Blue Cap Point": // monkey_l
                                    case "Blue Capture Point":
                                    case "BlueCapture Point": // haste_r
                                        eventType = EventType.PlayerCapturedFlag;
                                        data.team = TeamColor.Blue;
                                        break;
                                    case "Red Cap":
                                    case "Red_Cap":
                                    case "Red Cap Point":
                                    case "Red Capture Point":
                                    case "RedCapture Point":
                                        eventType = EventType.PlayerCapturedFlag;
                                        data.team = TeamColor.Red;
                                        break;
                                    case "Flag 1": // cornfield; e.g. "Flag 1", "Flag 2"
                                    case "Flag 2":
                                    case "Flag 3":
                                    case "Flag 4":
                                    case "Flag 5": // arendal
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.None;
                                        break;
                                    case "Flag #1": // osaka
                                    case "Flag #2":
                                    case "Flag #3":
                                    case "Flag #4":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.None;
                                        break;
                                    case "Blue Flag 1": // troy2
                                    case "Blue Flag 2":
                                    case "Blue Flag 3":
                                    case "Blue Flag 4":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Blue;
                                        break;
                                    case "Red Flag 1": // troy2
                                    case "Red Flag 2":
                                    case "Red Flag 3":
                                    case "Red Flag 4":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Red;
                                        break;
                                    case "Capture Point 1": // cornfield
                                    case "Capture Point 2":
                                    case "Capture Point 3":
                                    case "Capture Point 4":
                                        eventType = EventType.PlayerCapturedPoint;
                                        data.team = TeamColor.None;
                                        break;
                                    case "capture point 1": // magelli / arendal
                                    case "capture point 2": // magelli / arendal
                                    case "capture point 3": // magelli / arendal
                                    case "capture point 4": // magelli / arendal
                                    case "capture point 5": // arendal
                                        eventType = EventType.PlayerCapturedPoint;
                                        data.team = TeamColor.None;
                                        break;
                                    case "Blue Capture Point 1": // troy2
                                    case "Blue Capture Point 2":
                                    case "Blue Capture Point 3":
                                    case "Blue Capture Point 4":
                                    case "Red Capture Point 1": // troy2
                                    case "Red Capture Point 2":
                                    case "Red Capture Point 3":
                                    case "Red Capture Point 4":
                                        eventType = EventType.PlayerCapturedPoint;
                                        data.team = TeamColor.None;
                                        break;
                                    case "Team 1 dropoff":
                                    case "Team 2 dropoff":
                                    case "Team 3 dropoff":
                                    case "Team 4 dropoff":
                                        eventType = EventType.PlayerCapturedFlag;
                                        data.team = playerFrom!.team;
                                        break;
                                    case "Flag1": // asti_r flags
                                    case "Flag2":
                                    case "Flag3":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.None;
                                        break;
                                    case "Capture":
                                        if (nonPlayerDataParts[2] = "Point") {
                                            eventType = EventType.PlayerCapturedFlag;
                                            data.team = playerFrom!.team;
                                        }
                                        else
                                            throw "unknown player trigger Capture";
                                        break;
                                    case "Team":
                                        if (nonPlayerDataParts.length !== 4) {
                                            throw 'unknown player trigger Team';
                                        }

                                        switch (nonPlayerDataParts[3]) {
                                            case 'dropoff':
                                                eventType = EventType.PlayerCapturedFlag;
                                                data.team = TeamColor.None;
                                                break;
                                            default:
                                                throw 'unknown player trigger Team (len 3)';
                                        }
                                        break;
                                    case "t1df": // oppose2k1 flag dropoff (TODO: is this team-specific?)
                                    case "t2df":
                                        if (nonPlayerDataParts.length === 2) {
                                            eventType = EventType.PlayerCapturedFlag;
                                            data.team = playerFrom!.team;
                                        }
                                        else
                                            throw 'unknown t1df trigger';
                                        break;
                                    case "CEN BStat":
                                    case "CEN RStat":
                                        eventType = EventType.PlayerCapturedArenaCenter;
                                        break;
                                    case "BA BStat": // scrummage
                                    case "RA RStat": // scrummage
                                        eventType = EventType.PlayerCapturedArenaOwn;
                                        break;
                                    case "BA RStat": // scrummage
                                    case "RA BStat":
                                        eventType = EventType.PlayerCapturedArenaOpponent;
                                        break;
                                    case "greenX": // run (the map) flag pickup
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Green;
                                        break;
                                    case "yellowX":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        data.team = TeamColor.Yellow;
                                        break;
                                    case "blueflag_point": // run (the map) flag capture
                                    case "blueflag_point2":
                                    case "redflag_point":
                                    case "redflag_point2":
                                        if (nonPlayerDataParts.length === 2) {
                                            eventType = EventType.PlayerCapturedFlag;
                                            data.team = TeamColor.None;
                                        }
                                        else
                                            throw 'unknown "run"-like trigger';
                                        break;
                                    case 'rdet': // oppose2k1 water entrance det opened
                                    case 'bdet':
                                    case 'red_det': // 2mesa3 / stowaway2 water opened
                                    case 'blue_det':
                                    case 'rholedet': // cornfield cp4 / avanti
                                    case 'det1detect': // magelli
                                    case "det3detect": // arendal
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerOpenedDetpackEntrance;
                                        else
                                            throw 'unknown rdet/bdet trigger';
                                        break;
                                    case 'red_down': // schtop
                                    case 'blue_down':
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerGotSecurity;
                                        else
                                            throw 'unknown red_down/blue_down trigger';
                                        break;
                                    case 'red_up': // schtop
                                    case 'blue_up':
                                        if (nonPlayerDataParts.length === 2) {
                                            eventType = EventType.SecurityUp;
                                            const team = nonPlayerDataParts[1] === 'red_up' ? "red" : "blue";
                                            data.team = Event.parseTeam(team);
                                        }
                                        break;
                                    // ignore these triggers
                                    case '%s':
                                        let phrase = nonPlayerDataParts.slice(2).join(' ').toLowerCase();
                                        // ignore redundant flag message (proton_l / 2mach_b4)
                                        if (phrase === "capped the red flag" || phrase === "capped the blue flag")
                                            return;

                                        break;
                                    case 'amx_tsay':
                                    case 'amx_say':
                                    case 'amx_chat':
                                        // TODO: log amx-specific chat messages?
                                        break;
                                    case 'red_30': // 30s laser warning on schtop
                                    case 'blue_30': // 30s laser warning on schtop
                                    case 'ful': // full concs on oppose2k1
                                    case 'spawn_pak': // spawn pack on 2mesa3 (?)
                                    case 'blue_pak8': // spawn/gren pack on 2mesa3 (?)
                                    case 'func_button': // spawn door on 2mesa3 (either has "1" or "2" following)
                                    case 'func_button 1':
                                    case 'func_button 2':
                                    case 'Blue team spawn stuff': // cornfield spawn
                                    case 'Red team spawn stuff': // cornfield spawn
                                    case 'forced respawn': // cornfield force-respawn (?)
                                    case 'weaponstats': // adminmod "weaponstats" plugin (ignore specific dmg)
                                    case 'weaponstats2':// adminmod "weaponstats2" plugin (ignore specific dmg)
                                    case 'time': // adminmod 'time' plugin
                                    case 'latency': // adminmod 'latency' plugin
                                    case '#2fort_got_enemy_flag': // redundant 2mach_b4 flag message
                                    case 'Blue Bag': // ??
                                    case 'RED_SPAWN_three': // mulch_trench respawn?
                                    case 'RED_SPAWN_ONE': // mulch_trench_lg respawn
                                    // case 'grenbackpack': // ??
                                    case "ammo_giver": // osaka spawn trigger
                                    case "Blue team spawn stuff 1": // magelli / arendal spawn trigger
                                    case "Blue team spawn stuff 2": // magelli / arendal spawn trigger
                                    case "Blue team spawn stuff 3": // magelli / arendal spawn trigger
                                    case "Blue team spawn stuff 4": // arendal spawn trigger
                                    case "Blue team spawn stuff 5": // arendal spawn trigger
                                    case "Red team spawn stuff 1": // magelli / arendal spawn trigger
                                    case "Red team spawn stuff 2": // magelli / arendal spawn trigger
                                    case "Red team spawn stuff 3": // magelli / arendal spawn trigger
                                    case "Red team spawn stuff 4": // arendal spawn trigger
                                    case "Red team spawn stuff 5": // arendal spawn trigger
                                    case "warning sound1": // magelli message handling
                                    case "warning sound2": // magelli message handling
                                    case "warning sound3": // magelli message handling
                                    case "warning sound4": // magelli message handling
                                    case "Spawn mover 1": // magelli / arendal helper entity
                                    case "Spawn mover 2": // magelli / arendal helper entity
                                    case "Spawn mover 3": // arendal helper entity
                                    case "Spawn mover 4": // arendal helper entity
                                    case "spawn remover 1": // arendal helper entity
                                    case "spawn remover 2": // arendal helper entity
                                    case "spawn remover 3": // arendal helper entity
                                    case "spawn remover 5": // arendal helper entity
                                    case "Flag mover 1": // magelli / arendal helper entity
                                    case "Flag mover 2": // magelli / arendal helper entity
                                    case "Flag mover 3": // arendal helper entity
                                    case "Flag mover 4": // arendal helper entity
                                    case "attackers win": // magelli (already handled by world trigger Cease_Fire)
                                    case "Reset spawns": // magelli (already handled by world trigger Cease_Fire)
                                    case "reset flag": // magelli (already handled by world trigger Cease_Fire)
                                    case "Start message": // magelli (can be player or world, already handled by #dustbowl_gates_open)
                                    case "Attacker Spawn Stuff": // troy2 spawn trigger
                                    case "Defender Spawn Stuff": // troy2 spawn trigger
                                    case "backpack": // troy2 bags (netname = backpack)
                                    case "Grenades": // troy2 grenade bags
                                    case "Stop Scoring": // troy2 (already handled by world trigger Cease_Fire)
                                    case "End of Round": // troy2 (already handled by world trigger Cease_Fire)
                                    case "Respawn": // troy2 (already handled by world trigger Cease_Fire)
                                    case "Det wall reset": // troy2 (already handled by world trigger Cease_Fire)
                                    case "30 Second Warning": // troy2 (becomes player trigger after first round)
                                    case "10 Second Warning": // troy2 (becomes player trigger after first round)
                                    case "Start Scoring": // troy2
                                    case "Door Announcement": // troy2 (already handled by world trigger "The gates of Troy are open!")
                                    case "AmmoB": // scrummage
                                    case "AmmoB Tube": // scrummage
                                    case "AmmoR": // scrummage
                                    case "AmmoR Tube": // scrummage
                                    case "CannonB": // scrummage
                                    case "CannonR": // scrummage
                                    case "Fort BNoTP": // scrummage
                                    case "Fort RNoTP": // scrummage
                                    case "GrenB": // scrummage
                                    case "GrenR": // scrummage
                                    case "SCRUMB Pad": // scrummage
                                    case "SCRUM Red": // scrummage
                                    case "BA BPad1": // scrummage
                                    case "BA BPad2": // scrummage
                                    case "BA RPad1": // scrummage
                                    case "BA RPad2": // scrummage
                                    case "BA bonb": // scrummage
                                    case "BA bonr": // scrummage
                                    case "BA btmn1": // scrummage
                                    case "BA BTemp1": // scrummage
                                    case "BA BTemp2": // scrummage
                                    case "BA RTemp1": // scrummage
                                    case "BA RTemp2": // scrummage
                                    case "BA resupb": // scrummage
                                    case "BA btmn2": // scrummage
                                    case "BA rtmn1": // scrummage
                                    case "BA rtmn2": // scrummage
                                    case "CEN BPad1": // scrummage
                                    case "CEN BPad2": // scrummage
                                    case "CEN RPad1": // scrummage
                                    case "CEN RPad2": // scrummage
                                    case "CEN btmn1": // scrummage
                                    case "CEN btmn2": // scrummage
                                    case "CEN resupb": // scrummage
                                    case "CEN resupr": // scrummage
                                    case "CEN rtmn1": // scrummage
                                    case "CEN rtmn2": // scrummage
                                    case "CEN bonb": // scrummage
                                    case "CEN bonr": // scrummage
                                    case "CEN RNoTP": // scrummage
                                    case "CEN BTemp1": // scrummage
                                    case "CEN BTemp2": // scrummage
                                    case "CEN RTemp1": // scrummage
                                    case "CEN RTemp2": // scrummage
                                    case "RA BPad1": // scrummage
                                    case "RA BPad2": // scrummage
                                    case "RA RPad1": // scrummage
                                    case "RA RPad2": // scrummage
                                    case "RA bonb": // scrummage
                                    case "RA bonr": // scrummage
                                    case "RA BTemp1": // scrummage
                                    case "RA BTemp2": // scrummage
                                    case "RA RTemp1": // scrummage
                                    case "RA RTemp2": // scrummage
                                    case "RA btmn1": // scrummage
                                    case "RA btmn2": // scrummage
                                    case "RA rtmn1": // scrummage
                                    case "RA rtmn2": // scrummage
                                    case "spawnarea1": // attac
                                    case "spawnarea2": // attac
                                        return; // Ignore
                                    default:
                                        throw `unknown player trigger: ${nonPlayerDataParts[1]}`;
                                }
                                break;
                            }
                    }
                } else {
                    // handle non-player log messages

                    // if no matches, must be a malformed line (crashed server?)
                    if (!nonPlayerDataParts || nonPlayerDataParts.length === 0) {
                        return;
                    }
                    switch (nonPlayerDataParts[0]) {
                        case "Log":
                            if (nonPlayerDataParts[2] === "started")
                                eventType = EventType.StartLog;
                            else if (nonPlayerDataParts[2] === "closed")
                                eventType = EventType.EndLog;
                            else
                                throw "unknown 'log' message";
                            break;
                        case "Loading":
                            if (nonPlayerDataParts[1] === "map") {
                                eventType = EventType.MapLoading;
                                data.value = nonPlayerDataParts[2];
                            } else
                                throw "unknown 'loading' command";
                            break;
                        case "Started":
                            if (nonPlayerDataParts[1] === "map") {
                                eventType = EventType.MapLoaded;
                                data.value = nonPlayerDataParts[2];
                            } else
                                throw "unknown 'loading' command";
                            break;
                        case "Server":
                            switch (lineDataParts[1]) {
                                case "name":
                                    eventType = EventType.ServerName;
                                    data.value = lineDataParts[3];
                                    break;
                                case "cvars":
                                    if (nonPlayerDataParts[2] === "start")
                                        eventType = EventType.ServerCvarStart;
                                    else if (nonPlayerDataParts[2] === "end")
                                        eventType = EventType.ServerCvarEnd
                                    else
                                        throw "unknown 'server cvars' command";
                                    break;
                                case "cvar":
                                    eventType = EventType.ServerCvar;
                                    data.key = nonPlayerDataParts[2];
                                    data.value = nonPlayerDataParts[4];
                                    break;
                                case "say":
                                    eventType = EventType.ServerSay;
                                    data.value = nonPlayerDataParts.slice(2).join(' ');
                                    break;
                                default:
                                    throw "unknown 'server' command";
                            }
                            break;
                        case "Rcon":
                        case "Rcon:":
                            eventType = EventType.RconCommand;
                            data.value = nonPlayerDataParts[3];
                            break;
                        case "Bad":
                            if (nonPlayerDataParts[1] === "Rcon:") {
                                eventType = EventType.BadRcon;
                                data.value = nonPlayerDataParts[3];
                            }
                            break;
                        case "Kick":
                        case "Kick:":
                            eventType = EventType.PlayerKicked;
                            // usually, who was kicked is populated.
                            if (otherPlayerDataParts != null) {
                                const otherPlayerName = otherPlayerDataParts[1];
                                const otherPlayerID = Number(otherPlayerDataParts[2]);
                                const otherPlayerSteamID = otherPlayerDataParts[3];
                                const playerToTeam = this.parseTeam(otherPlayerDataParts[4]);
                                playerTo = roundState.ensurePlayer(otherPlayerSteamID, otherPlayerName, otherPlayerID, playerToTeam);
                                playerFrom = playerTo;
                            }
                            break;
                        case "World":
                            if (nonPlayerDataParts[1] !== "triggered") {
                                throw "unknown 'World' command";
                            }
                            switch (nonPlayerDataParts[2]) {
                                case "Match_Begins_Now":
                                    eventType = EventType.PrematchEnd;
                                    break;
                                case "Blue Flag Returned Message":
                                case "Red Flag Returned Message":
                                    eventType = EventType.FlagReturn;
                                    data.team = Event.parseTeam(nonPlayerDataParts[2].split(" ")[0]);
                                    break;
                                case "Flag has returned Info": // e.g. magelli / arendal
                                case "Flag 1 Return Messages": // troy2
                                case "Flag 2 Return Messages": // troy2
                                case "Flag 3 Return Messages": // troy2
                                case "Flag 4 Return Messages": // troy2
                                    eventType = EventType.FlagReturn;
                                    // No team is associated with this event.
                                    break;
                                case 'never': // TODO: normalize this a little across maps
                                    eventType = EventType.WorldTrigger;

                                    let lastIndex = lineData.lastIndexOf('"');
                                    if (lastIndex === lineData.length - 1)
                                        data.value = lineData.slice(lineData.lastIndexOf('"', lineData.length - 2), lineData.length - 1);
                                    else
                                        data.value = lineData.slice(lastIndex);
                                    break;
                                case "Cease_Fire": // e.g. dustbowl / cornfield / avanti
                                    eventType = EventType.ServerSwitchSides;
                                    break;
                                case "#dustbowl_gates_open": // e.g. dustbowl / cornfield / avanti
                                case "The gates of Troy are open!": // troy2
                                    eventType = EventType.ServerGatesOpen;
                                    break;
                                case "Blue Lasers Are Down": // stormz2
                                case "Red Lasers Are Down": // stormz2
                                case "Blue WATER ACCESS is OPEN for 60 seconds!":
                                case "Red WATER ACCESS is OPEN for 60 seconds!":
                                    eventType = EventType.PlayerGotSecurity;
                                    break;
                                case "Blue Lasers Restored!": // stormz2
                                case "Red Lasers Restored!": // stormz2
                                case "Blue WATER ACCESS is now DENIED!":
                                case "Red WATER ACCESS is now DENIED!":
                                    eventType = EventType.SecurityUp;
                                    break;
                                case "Red":
                                case "Blue":
                                    let phrase = nonPlayerDataParts.slice(2).join(' ');
                                    // turbo_b10
                                    if (phrase === "Blue Water access closing!" || phrase === "Red Water access closing!") {
                                        eventType = EventType.SecurityUp;
                                        break;
                                    }
                                    // ss_nyx_ectfc
                                    else if (phrase == "Blue team held their flag for 5 minutes!") {
                                        eventType = EventType.TeamFlagHoldBonus;
                                        data.team = TeamColor.Blue;
                                        break;
                                    }
                                    else if (phrase == "Red team held their flag for 5 minutes!") {
                                        eventType = EventType.TeamFlagHoldBonus;
                                        data.team = TeamColor.Red;
                                        break;
                                    }
                                    return; // ignore
                                case "Blue security has been deactivated!":
                                case "Red security has been deactivated!":
                                case "Blue Security has been Deactivated for 45s": // demolish
                                case "Red Security has been Deactivated for 45s": // demolish
                                case "Blue Security has been deactivate": // attac
                                case "Red Security has been deactivated": // attac
                                    eventType = EventType.PlayerGotSecurity;
                                    break;
                                case "Blue security will be operational in 30 seconds!": // schtop
                                case "Red security will be operational in 30 seconds!": // schtop
                                case "Blue Security will be Operational in 15 seconds!": // demolish
                                case "Red Security will be Operational in 15 seconds!": // demolish
                                case "Blue security will reactivate in 15 seconds": // attac
                                case "Red security will reactivate in 15 seconds": // attac
                                    return; // ignore
                                case "Blue security is now operating!":
                                case "Red security is now operating!":
                                case "Blue Security is now Operating": // demolish
                                case "Red Security is now Operating": // demolish
                                case "Blue security is now active": // attac
                                case "Red security is now active": // attac
                                    eventType = EventType.SecurityUp;
                                    break;
                                case "Blue_Flag_Vox":
                                case "Red_Flag_Vox":
                                case "#dustbowl_90_secs": // magelli
                                case "#dustbowl_60_secs": // dustbowl / cornfield
                                case "#dustbowl_30_secs": // dustbowl / cornfield
                                case "#dustbowl_10_secs": // dustbowl / cornfield
                                case "30 Second Warning": // troy2
                                case "The gates of Troy will open in 30 seconds!": // troy2
                                case "10 Second Warning": // troy2
                                case "The gates of Troy will open in 10 seconds!": // troy2
                                case "defenders_score": // adl-specific score for time held (e.g., cornfield)
                                case "Defenders Points": // troy2 version of defenders_score timer
                                case "Defender score timer": // magelli
                                case "warning sound1": // magelli
                                case "warning sound2": // magelli
                                case "warning sound3": // magelli
                                case "warning sound4": // magelli
                                case "Start message": // magelli (can be player or world, already handled by #dustbowl_gates_open)
                                case "Start Scoring": // troy2 (already handled by #dustbowl_gates_open)
                                case "Door Announcement": // troy2 (already handled by #dustbowl_gates_open)
                                case "Command Point 4 Wall Breached": // cornfield (already handled by rholedet)
                                case "Command Point Four breached!": // avanti(?) (already handled by rholedet)
                                case "#italy_hole_text": // avanti (already handled by rholedet)
                                case "#rock_red_yard_opened": // crossover2 (already handled by rholedet)
                                case "The blue cave has been breached": // stowaway2 (already handled by 'blue_det')
                                case "The red cave has been breached": // stowaway2 (already handled by 'red_det')
                                case "#well_bgrate_destroyed": // 2mesa3 (already handled by "blue_det")
                                case "#well_rgrate_destroyed": // 2mesa3 (already handled by "red_det")
                                case "The Flag has returned to the Gate!": // troy2 (already handled by "Flag 1 Return Messages")
                                case "The Flag has returned to Command Point ONE!": // troy2 (already handled by "Flag 2 Return Messages")
                                case "The Flag has returned to Command Point TWO!": // troy2 (already handled by "Flag 3 Return Messages")
                                case "The Flag has returned to Command Point THREE!": // troy2 (already handled by "Flag 4 Return Messages")
                                case "The Temple has been breached!": // troy2 wall det message - TODO: figure out which player triggered this?
                                case "New path to the delivery area is open!": // arendal (already handled by "det3detect")
                                case "#dustbowl_flag_returned": // arendal (already handled by "Flag has returned Info") - TODO: research potential conflict with dustbowl?
                                case "BA rest": // scrummage
                                case "BA BFlag": // scrummage
                                case "BA RFlag": // scrummage
                                case "RA rest": // scrummage
                                case "RA BFlag": // scrummage
                                case "RA RFlag": // scrummage
                                case "CEN BFlag": // scrummage
                                case "CEN RFlag": // scrummage
                                case "CEN rest": // scrummage
                                case undefined: // scrummage first line of multi-line arena capture output
                                    return; // Ignore
                                default:
                                    throw `unknown World trigger (${nonPlayerDataParts[2]})`;
                            }
                            break;
                        case "Team":
                            if (nonPlayerDataParts[2] !== "scored") {
                                throw "unknown 'Team' command";
                            }
                            eventType = EventType.TeamScore;
                            data.team = Event.parseTeam(nonPlayerDataParts[1]);
                            data.value = nonPlayerDataParts[3];
                            break;
                        case "[ETANA]":
                        case "[SUMMARY]": // dmg plugin summary
                            // TODO, log?
                            return;
                        case "[AMX]":
                            return;
                        case "<-1><><Blue>":
                        case "<-1><><Red>":
                        case "<-1><><Green>":
                        case "<-1><><Yellow>":
                            // frags that happen after the round ends
                            return;
                        case "<-1><><>":
                            // scrummage Sentry_Malfunction
                            return;
                        case "[MATCH":
                            // [MATCH RESULT] line on Coach's
                            return;
                        case "[GAMEND]":
                            // Coach's "[GAMEND] RECORDING STATS]" line
                            return;
                        default:
                            throw `unknown non-player log message (${nonPlayerDataParts[0]})`;
                    }
                }
            }
            // also catch any parserUtil errors (can only catch exceptions)
            catch (error) {
                const errorDescription = `Failed to parse line number ${lineNumber}: ${lineData} -- ${error}`;
                console.error(errorDescription);
                return errorDescription;
            }

            if (eventType != null && timestamp) {
                return new Event({
                    eventType: eventType,
                    rawLine: line,
                    lineNumber: lineNumber,
                    timestamp: timestamp,
                    data: data,
                    playerFrom: playerFrom,
                    playerTo: playerTo,
                    withWeapon: withWeapon,
                });
            }
        } else {
            // invalid line; skip
            return;
        }

        return `Unknown line (${lineNumber}) in log: ${line}`;
    }

    public get value(): string {
        return this.data && this.data.value || "(unknown)";
    }

    public get key(): string {
        return this.data && this.data.key || "(unknown)";
    }

    public static parseClass(playerClass: string): PlayerClass {
        playerClass = playerClass.trim();

        switch (playerClass) {
            case "Scout":
                return PlayerClass.Scout;
            case "Sniper":
                return PlayerClass.Sniper;
            case "Soldier":
                return PlayerClass.Soldier;
            case "Demoman":
                return PlayerClass.Demoman;
            case "Medic":
                return PlayerClass.Medic;
            case "HWGuy":
                return PlayerClass.HWGuy;
            case "Pyro":
                return PlayerClass.Pyro;
            case "Spy":
                return PlayerClass.Spy;
            case "Engineer":
                return PlayerClass.Engineer;
            case "Civilian":
                return PlayerClass.Civilian;
            case "RandomPC":
                return PlayerClass.Random;
            default:
                throw "undefined player class: " + playerClass;
        }
    }

    // TODO: should make this try to guess teams; apparently maps like baconbowl can customize these
    public static parseTeam(team: string): TeamColor {
        team = team.trim().toLowerCase();

        switch (team) {
            case "":
                return TeamColor.None;
            case "blue":
            case "blue :d?": // destroy_l
            case "dustbowl_team1": // baconbowl
            case "attackers": // attac
            case "#dustbowl_team1": // rasen
            case "goto clan": // osaka
                return TeamColor.Blue;
            case "red":
            case "red :d?": // destroy_l
            case "dustbowl_team2": // baconbowl
            case "defenders": // attac
            case "#dustbowl_team2": // rasen
            case "ii clan": // osaka
                return TeamColor.Red;
            case "yellow":
                return TeamColor.Yellow;
            case "green":
                return TeamColor.Green;
            case "spectator":
                return TeamColor.Spectator;
            default:
                throw "unknown team: " + team;
        }
    }

    public static parseWeapon(weapon: string): Weapon {
        weapon = weapon.trim();

        // strip the "with" if it preceds the weapon, if it exists
        if (weapon.startsWith("with"))
            weapon = weapon.trim().substr(5);

        // strip any quotes, if they exist
        if (weapon.indexOf("\"") !== -1) {
            weapon = weapon.replace(/"/gi, "");
        }

        switch (weapon) {
            case "normalgrenade":
                return Weapon.NormalGrenade;
            case "nailgrenade":
                return Weapon.NailGrenade;
            case "mirvgrenade":
                return Weapon.MirvGrenade;
            case "supernails":
            case "superng":
                return Weapon.Supernails;
            case "nails":
            case "ng":
                return Weapon.Nails;
            case "crowbar":
            case "axe":
                return Weapon.Crowbar;
            case 'spanner':
                return Weapon.Spanner;
            case 'medikit':
                return Weapon.Medkit;
            case "shotgun":
                return Weapon.Shotgun;
            case "supershotgun":
                return Weapon.SuperShotgun;
            case "rocket":
            case 'rpg':
                return Weapon.Rocket;
            case "ac":
                return Weapon.AutoCannon;
            case "sentrygun":
                return Weapon.SentryGun;
            case "pipebomb":
            case "pl":
                return Weapon.GreenPipe;
            case 'gl_grenade':
            case 'gl':
                return Weapon.BluePipe;
            case "building_dispenser":
            case "dispenser":
                return Weapon.BuildingDispenser;
            case "building_sentrygun":
            case "sentrygun":
            case "sentrygun (world)":
                return Weapon.BuildingSentryGun;
            case "building_teleporter":
            case "teleporter":
                return Weapon.BuildingTeleporter;
            case "Teleporter_Entrance_Finished":
                return Weapon.BuildingTeleporterEntrance;
            case "Teleporter_Exit_Finished":
                return Weapon.BuildingTeleporterExit;
            case "detpack":
                return Weapon.Detpack;
            case "empgrenade":
                return Weapon.EmpGrenade;
            case "railgun":
                return Weapon.Railgun;
            case "flames":
            case "flamethrower": // TODO really?
            case "ic": // TODO should be IC
                return Weapon.Flames;
            case "napalmgrenade":
                return Weapon.NapalmGrenade;
            case "caltrop":
                return Weapon.Caltrop;
            case "gasgrenade":
                return Weapon.GasGrenade;
            case "knife":
                return Weapon.Knife;
            case "tranq":
                return Weapon.Tranquilizer;
            case "headshot":
                return Weapon.Headshot;
            case "sniperrifle":
                return Weapon.SniperRifle;
            case "autorifle":
                return Weapon.AutoRifle;
            case "infection":
                return Weapon.Infection;
            case "door (world)": // TODO: door frag?
            case "door_rotating (world)": // haste_r
                return Weapon.WorldDoor;
            case "the red lift (world)": // openfire
            case "the blue lift (world)": // openfire
                return Weapon.WorldLift;
            case "teledeath": // TODO: is this a spawn telefrag?
            case "teledeath (world)": // TODO: is this a spawn telefrag?
            case "world":
            case "worldspawn":
            case "worldspawn (world)":
            case "miniturret (world)": // TODO: call this out?
            case "timer (world)": // getting killed after round ends (e.g. infection kill after time)
            case "normalgrenade (world)": // getting killed after round ends (e.g. suicide via grenade):
            case "mirvgrenade (world)":
            case "nailgrenade (world)":
            case "env_explosion (world)": // attac
                return Weapon.WorldSpawn;
            case "trigger_hurt":
            case "trigger_hurt (world)": // TODO: this could be a trigger at the bottom of a pit (shutdown) or world (orbit), how can we distinguish with fall damage?
            case "the red team's lasers (world)": // orbit_l3
            case "the blue team's lasers (world)": // orbit_l3
            case "env_beam (world)": // stormz2
            case "rock_laser_kill (world)": // baconbowl
            case "info_tfgoal (world)": // fry_complex
                return Weapon.Lasers;
            case "train":
            case "train (world)":
                return Weapon.Train;
            case "rock_falling_death (world)": // 2mesa3
            case "#rock_falling_death (world)":
                return Weapon.WorldPit;
            case "timer":
                return Weapon.None;
            default:
                throw "unknown weapon: " + weapon;
        }
    }
}

interface ExtraData {
    class?: PlayerClass;
    team?: TeamColor;
    building?: Weapon;
    level?: number;
    key?: string;
    value?: string;
    mapLocation?: MapLocation;
}

export default Parser;
