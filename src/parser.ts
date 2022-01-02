import * as fs from 'fs';
import EventType from './eventType.js';
import Player from './player.js';
import PlayerList from './playerList.js';
import { OutputStats, PlayerClass, TeamColor, Weapon, TeamStatsComparison, OutputPlayer } from './constants.js';
import ParserUtils, { TeamComposition } from './parserUtils.js';

type RoundStats = (OutputStats | undefined)[];
export interface ParsedStats {
    stats: RoundStats;
    players: TeamComposition<OutputPlayer>;
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
                console.log(`parsed ${this.rounds.length} files.`);
                // TODO: be smarter about ensuring team composition matches, map matches, etc. between rounds
                const stats = this.rounds.map(round => round.stats);

                let comparison: TeamStatsComparison | undefined;
                let teamComp: TeamComposition<OutputPlayer> = ParserUtils.teamCompToOutput(this.rounds[0]!.teams!);
                if (this.rounds.length === 2) {
                    comparison = ParserUtils.generateTeamRoleComparison(stats as [OutputStats, OutputStats]);
                    teamComp = ParserUtils.generateTeamComposition(this.rounds) || teamComp;
                }

                // calculate game-wide rankings (like MVP?); this'll side-effect stats
                ParserUtils.setGameAwards(teamComp, stats);

                return <ParsedStats> {
                    players: teamComp,
                    stats,
                    comparison,
                };
            });
    }
}

export class RoundParser {
    private rawLogData: string = "";
    private doneReading: boolean = false;
    private players: PlayerList = new PlayerList();

    private allEvents: string[] = [];
    public events: Event[] = [];

    private teamComp: TeamComposition | undefined;
    private summarizedStats: OutputStats | undefined;

    constructor(private filename: string) {
        // should probably check if the file exists here
    }

    public async parseFile(): Promise<void> {
        return this.parseRound(this.filename)
            .catch(() => console.error(`failed to parse file ${this.filename}.`));
    }

    private async parseRound(filename: string): Promise<void> {
        return new Promise<void>(resolve => {
            const logStream = fs.createReadStream(filename);
            logStream.on('data', chunk => {
                this.rawLogData += chunk;
            }).on('end', () => {
                resolve();
                this.doneReading = true;
                this.parseData();
            }).on('error', (error) => {
                resolve();
                console.log(error);
            });
        });
    }

    public get done(): boolean {
        return this.doneReading;
    }

    public data(): string {
        return this.rawLogData;
    }

    public get stats(): OutputStats | undefined {
        return this.summarizedStats;
    }

    public get teams(): TeamComposition | undefined {
        return this.teamComp;
    }

    private parseData(): void {
        this.allEvents = this.rawLogData.split("\n");

        this.allEvents.forEach((event, lineNumber) => {
            const newEvent = Event.createEvent(lineNumber, event, this.players);
            if (newEvent)
                this.events.push(newEvent);
        });

        this.teamComp = ParserUtils.getPlayerTeams(this.events, this.players);
        const [scores, flagMovements] = ParserUtils.getScoreAndFlagMovements(this.events);
        for (const team in this.teamComp) {
            const teamPlayers = this.teamComp[team];
            const score = scores[team];
            console.log(`Team ${team} (score ${score}) has ${teamPlayers.length} players: ${teamPlayers.join(', ')}.`);
        }

        // find prematch start and match end; ignore events outside that (except chat/class choice/team join?)
        this.trimPreAndPostMatchEvents();

        const playerStats = ParserUtils.getPlayerStats(this.events, this.teamComp);
        this.summarizedStats = ParserUtils.generateOutputStats(this.events, playerStats, this.players, this.teamComp, this.filename);
    }

    private trimPreAndPostMatchEvents() {
        const matchStartEvent = this.events.find(event => event.eventType === EventType.PrematchEnd) || this.events[0];
        const matchEndEvent = this.events.find(event => event.eventType === EventType.TeamScore) || this.events[this.events.length - 1];

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
        }
    }
}

export interface EventCreationOptions {
    eventType: EventType;
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
    public eventType: EventType;
    public lineNumber: number;
    public timestamp: Date;
    public gameTimeAsSeconds?: number;

    public data?: ExtraData;
    public playerFrom?: Player;
    public playerFromClass?: PlayerClass;
    public playerTo?: Player;
    public playerToClass?: PlayerClass;
    public withWeapon?: Weapon;
    public whileConced: boolean;

    constructor(options: EventCreationOptions) {
        // required fields
        this.eventType = options.eventType;
        this.lineNumber = options.lineNumber;
        this.timestamp = options.timestamp;

        // optional fields
        this.data = options.data;
        this.playerFrom = options.playerFrom;
        this.playerFromClass = options.playerFromClass;
        this.playerTo = options.playerTo;
        this.playerToClass = options.playerToClass;
        this.withWeapon = options.withWeapon;
        this.whileConced = false; // Filled in later.
    }

    public static createEvent(lineNumber: number, line: string, playerList: PlayerList): Event | undefined {
        let eventType: EventType | undefined;
        let timestamp: Date | undefined;

        let data: ExtraData = {};
        let withWeapon: Weapon | undefined;
        let playerFrom: Player | undefined;
        let playerTo: Player | undefined;

        // a valid log line must start with 'L'
        if (line[0] === 'L') {
            // parse date
            timestamp = new Date(line.substr(2, 21).replace(" - ", " "));

            // figure out the type of event (TODO)
            const lineData = line.substr(25);

            // RE to split up words (TODO: also remove quotes?)
            let lineDataRE = /(\b[^\s]+\b)/ig;

            // RE to obtain full quoted parts (only needed in certain instances to get user-supplied info like chat/server name)
            let lineQuoteRE = /(?<=\")[^\"]*(?=\")|[^\" ]+/ig;

            // try to match player names
            let playerRE = /"([^"]*)<([0-9]+)><STEAM_([0-9:]+)><[_#0-9a-z]*>"/ig
            const lineDataParts = lineData.split(playerRE);

            // short-circuit HLTV/Metamod for now (TODO)
            if (lineData.indexOf('<HLTV><>') !== -1 || lineData.indexOf('[META]') !== -1)
                return;

            const data: ExtraData = {};

            // if there is a player match, we'll have multiple parts
            if (lineDataParts.length >= 2) {
                const playerName = lineDataParts[1];
                const playerID = Number(lineDataParts[2]);
                const playerSteamID = lineDataParts[3];

                playerFrom = playerList.getPlayer(playerSteamID, playerName, playerID);

                const eventText = lineDataParts[4].trim();

                // if there are six matches, two people were affected
                if (lineDataParts.length >= 7) {
                    const offendingPlayerName = lineDataParts[5];
                    const offendingPlayerID = Number(lineDataParts[6]);
                    const offendingPlayerSteamID = lineDataParts[7];

                    playerTo = playerList.getPlayer(offendingPlayerSteamID, offendingPlayerName, offendingPlayerID);

                    // do a switch based on the statement
                    const withText = lineDataParts[8].trim();

                    const eventTextParts = eventText.split(" ");
                    switch (eventTextParts[0]) {
                        case "killed":
                            if (withText.startsWith("with")) {
                                eventType = EventType.PlayerFraggedPlayer;
                                withWeapon = Event.parseWeapon(withText);
                            } else
                                console.log("Unknown 'killed' event: " + line);
                            break;
                        case "triggered":
                            if (eventTextParts[1].startsWith("\"airshot")) {
                                eventType = EventType.PlayerHitAirshot;
                                withWeapon = eventTextParts[1].indexOf('gl') === 0 ? Weapon.BluePipe : Weapon.Rocket;
                                data.value = withText.split(" ")[4];

                            } else if (eventTextParts[1] === "\"Concussion_Grenade\"") {
                                eventType = EventType.PlayerConced;

                            } else if (eventTextParts[1] === "\"Sentry_Destroyed\"") {
                                eventType = EventType.PlayerFraggedGun;
                                withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1] === `"Dispenser_Destroyed"`) {
                                eventType = EventType.PlayerFraggedDispenser;
                                withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1] === `"Teleporter_Entrance_Destroyed"` || eventTextParts[1] === `"Teleporter_Exit_Destroyed"`) {
                                eventType = EventType.PlayerFraggedTeleporter;
                                withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1].startsWith(`"Sentry_Upgrade`)) {
                                eventType = EventType.PlayerUpgradedOtherGun;
                                data.level = Number(eventTextParts[1][eventTextParts[1].length - 1]);

                            } else if (eventTextParts[1] === `"Sentry_Repair"`) {
                                eventType = EventType.PlayerRepairedBuilding;
                                data.building = Event.parseWeapon("sentrygun");

                            } else if (eventTextParts[1] === `"Detpack_Disarmed"`) {
                                eventType = EventType.PlayerDetpackDisarm;

                            } else if (eventTextParts[1] === `"Medic_Heal"`) {
                                eventType = EventType.PlayerHeal;

                            } else if (eventTextParts[1] === `"Caltrop_Grenade"`) {
                                eventType = EventType.PlayerCaltroppedPlayer;

                            } else if (eventTextParts[1] === `"Spy_Tranq"`) {
                                eventType = EventType.PlayerTranqedPlayer;

                            } else if (eventTextParts[1] === `"Hallucination_Grenade"`) {
                                eventType = EventType.PlayerHallucinatedPlayer;

                            } else if (eventTextParts[1] === `"Medic_Infection"`) {
                                eventType = EventType.PlayerInfectedPlayer;

                            } else if (eventTextParts[1] === `"Passed_On_Infection"`) {
                                eventType = EventType.PlayerPassedInfection;

                            } else if (eventTextParts[1] === `"Medic_Cured_Infection"`) {
                                eventType = EventType.PlayerCuredInfection;

                            } else if (eventTextParts[1] === `"Discovered_Spy"`) {
                                eventType = EventType.PlayerRevealedSpy;

                            } else if (eventTextParts[1] === `"Medic_Doused_Fire"`) {
                                eventType = EventType.PlayerDousedFire;

                            } else if (eventTextParts[1] === `"Medic_Cured_Hallucinations"`) {
                                eventType = EventType.PlayerCuredHallucinations;

                            } else {
                                console.log("unknown 'triggered' event: " + line);
                                throw ""; // TODO
                            }
                            break;
                        default:
                            console.log("Unknown multi-player event: " + line);
                            throw ""; // TODO
                    }
                } else {
                    let parts = eventText.match(lineDataRE) as RegExpMatchArray; // force to never be null (should always find words)

                    // should generally never fail here, but it is possible if someone concs after time ends
                    // for example: "<-1><><Blue>" triggered "Concussion_Grenade" against "hello? A Wheat and Greet pls<27><STEAM_0:0:90069><Red>"
                    if (!parts) {
                        console.error("unknown two-player trigger (next line has original log line)");
                    }
                    else {
                        switch (parts[0]) {
                            case "say_team":
                            case "say":
                                // TODO: does say_team always create an extra new-line?
                                eventType = parts[0] === "say_team" ? EventType.PlayerMM2 : EventType.PlayerMM1;
                                const firstQuote = eventText.search('"');
                                let text = eventText.slice(firstQuote + 1);

                                // remove the last quote, if it exists
                                if (text[text.length - 1] === '"')
                                    text = text.slice(0, text.length - 1).trim();

                                data.value = text;
                                break;
                            case "joined":
                                eventType = EventType.PlayerJoinTeam;
                                data.team = Event.parseTeam(parts[2]);
                                break;
                            case "entered":
                                eventType = EventType.PlayerJoinServer;
                                break;
                            case "changed":
                                // TOOD: track name changes; for now, just drop the event
                                if (parts[1] === "name")
                                    break;

                                eventType = EventType.PlayerChangeRole;
                                data.class = Event.parseClass(parts[3]);
                                break;
                            case "committed": // TODO: sometimes this line has extra data
                            /* e.g., L 11/20/2018 - 01:54:42: "phone<59><STEAM_0:0:44791068><Blue>" committed suicide with "trigger_hurt" (world); L 11/20/2018 - 01:46:41: "pheesh-L7<64><STEAM_0:0:64178><Red>" committed suicide with "train" (world); "tomaso<19><STEAM_0:0:7561319><Blue>" committed suicide with "the red team's lasers" (world) */
                                eventType = EventType.PlayerCommitSuicide;
                                withWeapon = Event.parseWeapon(parts.slice(3).join(' '));
                                break;
                            case "triggered":
                                switch (parts[1]) {
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
                                    case "Sentry_Repair":
                                        eventType = EventType.PlayerRepairedBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Built_Dispenser":
                                        eventType = EventType.PlayerBuiltDispenser;
                                        break;
                                    case "Teleporter_Entrace_Finished":
                                    case "Teleporter_Entrance_Finished":
                                    case "Teleporter_Exit_Finished":
                                        eventType = EventType.PlayerBuiltTeleporter;
                                        data.building = Event.parseWeapon(parts[1]);
                                        break;
                                    case "Dispenser_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("dispenser");
                                        break;
                                    case "Sentry_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Sentry_Dismantle":
                                        eventType = EventType.PlayerDismantledBuilding;
                                        data.building = Event.parseWeapon("sentrygun");
                                        break;
                                    case "Teleporter_Exit_Destroyed":
                                    case "Teleporter_Entrance_Destroyed":
                                        eventType = EventType.PlayerDetonatedBuilding;
                                        data.building = Event.parseWeapon("teleporter");
                                    case "Detpack_Set":
                                        eventType = EventType.PlayerDetpackSet;
                                        break;
                                    case "Detpack_Explode":
                                        eventType = EventType.PlayerDetpackExplode;
                                        break;
                                    case "dropitems": // custom event for Inhouse
                                        eventType = EventType.PlayerThrewFlag;
                                        break;
                                    case "goalitem":
                                        if (parts.length === 2)
                                            eventType = EventType.PlayerPickedUpFlag;
                                        else
                                            console.error('unknown player trigger "goalitem": ' + eventText);
                                        break;
                                    case "Red":
                                    case "Blue":
                                        switch (parts[2]) {
                                            case "Flag":
                                                if (parts[3] === "Plus") // raiden6 c2c entity pickup
                                                    eventType = EventType.PlayerPickedUpBonusFlag;
                                                else
                                                    eventType = EventType.PlayerPickedUpFlag;
                                                break;
                                            case "Cap":
                                                if (parts[3] === "Point") // monkey_l
                                                    eventType = EventType.PlayerCapturedFlag;
                                                else if (parts.length === 3) // waterwar
                                                    eventType = EventType.PlayerCapturedFlag;
                                                else
                                                    console.error('unknown player trigger "Red/Blue Cap": ' + eventText);
                                                break;
                                            case "Capture":
                                                if (parts[3] === "Point") // orbit_l3
                                                    eventType = EventType.PlayerCapturedFlag;
                                                else
                                                    console.error('unknown player trigger "Red/Blue Capture": ' + eventText);
                                                break;
                                            case "team":
                                                if (parts[3] === "spawn") // ksour spawn? ("red team spawn stuff")
                                                    break;
                                            default:
                                                console.error('unknown player trigger Red/Blue: ' + eventText);
                                        }
                                        break;
                                    case "Red_Flag": // proton_l
                                    case "Blue_Flag":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "Red_Cap": // proton_l
                                    case "Blue_Cap":
                                        eventType = EventType.PlayerCapturedFlag;
                                        break;
                                    case "Flag": // cornfield; e.g. "Flag 1", "Flag 2"
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "Capture":
                                        if (parts[2] = "Point")
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error("unknown player trigger Capture: " + eventText);
                                        break;
                                    case "Team":
                                        if (parts.length !== 4) {
                                            console.error('unknown player trigger Team: ' + eventText);
                                            break;
                                        }

                                        switch (parts[3]) {
                                            case 'dropoff':
                                                eventType = EventType.PlayerCapturedFlag;
                                                break;
                                            default:
                                                console.error('unknown player trigger Team (len 3): ' + eventText);
                                        }
                                        break;
                                    case "t1df": // oppose2k1 flag dropoff (TODO: is this team-specific?)
                                    case "t2df":
                                        if (parts.length === 2)
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error('unknown t1df trigger: ' + eventText);
                                        break;
                                    case "blueflag_point": // run (the map) flag capture
                                    case "blueflag_point2":
                                    case "redflag_point":
                                    case "redflag_point2":
                                        if (parts.length === 2)
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error('unknown "run"-like trigger: ' + eventText);
                                        break;
                                    case 'rdet': // oppose2k1 water entrance det opened
                                    case 'bdet':
                                    case 'red_det': // 2mesa3 water opened
                                    case 'blue_det':
                                        if (parts.length === 2)
                                            eventType = EventType.PlayerOpenedDetpackEntrance;
                                        else
                                            console.error('unknown rdet/bdet trigger: ' + eventText);
                                        break;
                                    case 'red_down': // schtop
                                    case 'blue_down':
                                        if (parts.length === 2)
                                            eventType = EventType.PlayerGotSecurity;
                                        else
                                            console.error('unknown red_down/blue_down trigger: ' + eventText);
                                        break;
                                    case 'red_up': // schtop
                                    case 'blue_up':
                                        if (parts.length === 2) {
                                            eventType = EventType.SecurityUp;
                                            const team = parts[1] === 'red_up' ? "red" : "blue";
                                            data.team = Event.parseTeam(team);
                                        }
                                        break;
                                    // ignore these triggers
                                    case 'red_30': // 30s laser warning on schtop
                                    case 'blue_30': // 30s laser warning on schtop
                                    case 'ful': // full concs on oppose2k1
                                    case 'spawn_pak': // spawn pack on 2mesa3 (?)
                                    case 'blue_pak8': // spawn/gren pack on 2mesa3 (?)
                                    case 'func_button': // spawn door on 2mesa3 (either has "1" or "2" following)
                                        break;
                                    default:
                                        console.error(`unknown player trigger: ${parts[1]}: ${eventText}`);
                                }
                                break;

                        }
                    }
                }
            } else {
                // handle non-player log messages
                let parts = lineData.match(lineDataRE) as RegExpMatchArray; // force to never be null (should always find words)
                // if no matches, must be a malformed line (crashed server?)
                if (!parts || parts.length === 0)
                    return;

                switch (parts[0]) {
                    case "Log":
                        if (parts[2] === "started")
                            eventType = EventType.StartLog;
                        else if (parts[2] === "closed")
                            eventType = EventType.EndLog;
                        else
                            console.error("Unknown 'log' message: " + lineData);
                        break;
                    case "Loading":
                        if (parts[1] === "map") {
                            eventType = EventType.MapLoading;
                            data.value = parts[2];
                        } else
                            console.error("unknown 'loading' command: " + lineData);
                        break;
                    case "Started":
                        if (parts[1] === "map") {
                            eventType = EventType.MapLoaded;
                            data.value = parts[2];
                        } else
                            console.error("unknown 'loading' command: " + lineData);
                        break;
                    case "Server":
                        switch (parts[1]) {
                            case "name":
                                eventType = EventType.ServerName;
                                let quoteParts = lineData.match(lineQuoteRE) as RegExpMatchArray;
                                data.value = quoteParts?.[3];
                                break;
                            case "cvars":
                                if (parts[2] === "start")
                                    eventType = EventType.ServerCvarStart;
                                else if (parts[2] === "end")
                                    eventType = EventType.ServerCvarEnd
                                else
                                    console.error("unknown 'server cvars' command: " + lineData);
                                break;
                            case "cvar":
                                eventType = EventType.ServerCvar;
                                data.key = parts[2];
                                data.value = parts[3];
                                break;
                            default:
                                console.error("unknown 'server' command: " + lineData);
                        }
                        break;
                    case "Rcon":
                        eventType = EventType.RconCommand;
                        data.value = parts.slice(4).join(' ');
                        break;
                    case "World":
                        if (parts[1] !== "triggered") {
                            console.error("unknown 'World' command: " + lineData);
                            break;
                        }
                        switch (parts[2]) {
                            case "Match_Begins_Now":
                                eventType = EventType.PrematchEnd;
                                break;
                            case "Red":
                            case "Blue":
                                if (parts.slice(3).join(' ') === "Flag Returned Message") {
                                    eventType = EventType.FlagReturn;
                                    data.team = Event.parseTeam(parts[2]);
                                }
                                else
                                    console.log('unknown World "Red/Blue ..." trigger: ' + lineData);
                                break;
                            case 'never': // TODO: normalize this a little across maps
                                eventType = EventType.WorldTrigger;

                                let lastIndex = lineData.lastIndexOf('"');
                                if (lastIndex === lineData.length - 1)
                                    data.value = lineData.slice(lineData.lastIndexOf('"', lineData.length - 2), lineData.length - 1);
                                else
                                    data.value = lineData.slice(lastIndex);
                                break;
                            default:
                                console.log('unknown World trigger: ' + lineData);
                        }
                        break;
                    case "Team":
                        if (parts[2] !== "scored") {
                            console.error("unknown 'Team' command: " + lineData);
                            break;
                        }
                        eventType = EventType.TeamScore;
                        data.team = Event.parseTeam(parts[1])
                        data.value = parts[3];
                        break;
                    default:
                        console.error('unknown non-player log message: ' + lineData);
                }
            }

            if (eventType && timestamp) {
                return new Event({
                    eventType: eventType,
                    lineNumber: lineNumber,
                    timestamp: timestamp,
                    data: data,
                    playerFrom: playerFrom,
                    playerTo: playerTo,
                    withWeapon: withWeapon,
                });
            }
        }

        console.log("unknown line in log: " + line);
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
            case "blue":
            case "dustbowl_team1": // baconbowl
                return TeamColor.Blue;
            case "red":
            case "dustbowl_team2": // baconbowl
                return TeamColor.Red;
            case "yellow":
                return TeamColor.Yellow;
            case "green":
                return TeamColor.Green;
            case "spectator":
                return TeamColor.Spectator;
            default:
                throw "undefined team: " + team;
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
            case "teledeath": // TODO: is this a spawn telefrag?
            case "teledeath world": // TODO: is this a spawn telefrag?
            case "door world": // TODO: door frag?
            case "world":
            case "worldspawn":
            case "worldspawn world":
            case "miniturret world": // TODO: call this out?
            case "the red lift world": // openfire
            case "the blue lift world": // openfire
            case "timer world": // getting killed after round ends (e.g. infection kill after time)
                return Weapon.WorldSpawn;
            case "trigger_hurt":
            case "trigger_hurt world": // TODO: this could be a trigger at the bottom of a pit (shutdown) or world (orbit), how can we distinguish with fall damage?
            case "the red team's lasers world": // orbit_l3
            case "the blue team's lasers world": // orbit_l3
            case "env_beam world": // stormz2
            case "rock_laser_kill world": // baconbowl
                return Weapon.Lasers;
            case "train":
            case "train world":
                return Weapon.Train;
            case "rock_falling_death world": // 2mesa3
                return Weapon.Pit;
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
}

export default Parser;
