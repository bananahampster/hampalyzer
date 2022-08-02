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
            const newEvent = Event.createEvent(lineNumber + 1, event, this.players);
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

        console.log(`Map: ${this.summarizedStats.map}`);
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
    playerFromTeam?: TeamColor;
    playerFromClass?: PlayerClass;
    playerTo?: Player;
    playerToTeam?: TeamColor;
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
    public playerFromTeam?: TeamColor;
    public playerFromClass?: PlayerClass;
    public playerTo?: Player;
    public playerToTeam?: TeamColor;
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
        this.playerFromTeam = options.playerFromTeam;
        this.playerFromClass = options.playerFromClass;
        this.playerTo = options.playerTo;
        this.playerToTeam = options.playerToTeam;
        this.playerToClass = options.playerToClass;
        this.withWeapon = options.withWeapon;
        this.whileConced = false; // Filled in later.
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

    public static createEvent(lineNumber: number, line: string, playerList: PlayerList): Event | undefined {
        let eventType: EventType | undefined;
        let timestamp: Date | undefined;

        let withWeapon: Weapon | undefined;
        let playerFrom: Player | undefined;
        let playerFromTeam: TeamColor | undefined;
        let playerTo: Player | undefined;
        let playerToTeam: TeamColor | undefined;

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

            const data: ExtraData = {};

            // Wrap in a try/catch so we can log the line number for a failed parse.
            try {
                // if there is a player match, we'll have multiple parts
                if (fromPlayerDataParts !== null) {
                    const playerName = fromPlayerDataParts[1];
                    const playerID = Number(fromPlayerDataParts[2]);
                    const playerSteamID = fromPlayerDataParts[3];
                    playerFromTeam = fromPlayerDataParts[4] !== "" ? this.parseTeam(fromPlayerDataParts[4]) : undefined;

                    playerFrom = playerList.getPlayer(playerSteamID, playerName, playerID);

                    if (otherPlayerDataParts != null) { // Two players were affected.
                        const otherPlayerName = otherPlayerDataParts[1];
                        const otherPlayerID = Number(otherPlayerDataParts[2]);
                        const otherPlayerSteamID = otherPlayerDataParts[3];
                        playerToTeam = otherPlayerDataParts[4] !== "" ? this.parseTeam(otherPlayerDataParts[4]) : undefined;

                        playerTo = playerList.getPlayer(otherPlayerSteamID, otherPlayerName, otherPlayerID);
                        // do a switch based on the statement
                        switch (nonPlayerDataParts[0]) {
                            case "killed":
                                if (nonPlayerDataParts[1] === "with") {
                                    eventType = EventType.PlayerFraggedPlayer;
                                    withWeapon = Event.parseWeapon(nonPlayerDataParts[2]);
                                } else
                                    console.log("Unknown 'killed' event: " + line);
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
                                    data.level = Number(nonPlayerDataParts[1][nonPlayerDataParts[1].length - 1]);

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
                                    console.log("unknown 'triggered' event: " + line);
                                    throw ""; // TODO
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
                                console.log("Unknown multi-player event: " + line);
                                throw ""; // TODO
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
                                    case "goalitem":
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerPickedUpFlag;
                                        else
                                            console.error('unknown player trigger "goalitem": ' + lineData);
                                        break;
                                    case "Red Flag":
                                    case "Blue Flag":
                                    case "Red_Flag": // proton_l
                                    case "Blue_Flag":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "Red Flag Plus": // raiden-style c2c entity pickup
                                    case "Blue Flag Plus":
                                        eventType = EventType.PlayerPickedUpBonusFlag;
                                        break;
                                    case "Blue Capture Point Extra": // cranked
                                    case "Red Capture Point Extra":
                                        eventType = EventType.PlayerCapturedBonusFlag;
                                        break;
                                    case "Capture Point":
                                    case "Blue Cap":
                                    case "Red Cap":
                                    case "Blue_Cap":
                                    case "Red_Cap":
                                    case "Blue Cap Point": // monkey_l
                                    case "Red Cap Point":
                                    case "Blue Capture Point":
                                    case "Red Capture Point":
                                    case "BlueCapture Point": // haste_r
                                    case "RedCapture Point":
                                        eventType = EventType.PlayerCapturedFlag;
                                        break;
                                    case "Flag 1": // cornfield; e.g. "Flag 1", "Flag 2"
                                    case "Flag 2":
                                    case "Flag 3":
                                    case "Flag 4":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "Capture Point 1": // cornfield
                                    case "Capture Point 2":
                                    case "Capture Point 3":
                                    case "Capture Point 4":
                                        eventType = EventType.PlayerCapturedFlag;
                                        break;
                                    case "Team 1 dropoff":
                                    case "Team 2 dropoff":
                                    case "Team 3 dropoff":
                                    case "Team 4 dropoff":
                                        eventType = EventType.PlayerCapturedFlag;
                                        break;
                                    case "Flag1": // asti_r flags
                                    case "Flag2":
                                    case "Flag3":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "Capture":
                                        if (nonPlayerDataParts[2] = "Point")
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error("unknown player trigger Capture: " + lineData);
                                        break;
                                    case "Team":
                                        if (nonPlayerDataParts.length !== 4) {
                                            console.error('unknown player trigger Team: ' + lineData);
                                            break;
                                        }

                                        switch (nonPlayerDataParts[3]) {
                                            case 'dropoff':
                                                eventType = EventType.PlayerCapturedFlag;
                                                break;
                                            default:
                                                console.error('unknown player trigger Team (len 3): ' + lineData);
                                        }
                                        break;
                                    case "t1df": // oppose2k1 flag dropoff (TODO: is this team-specific?)
                                    case "t2df":
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error('unknown t1df trigger: ' + lineData);
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
                                    case "yellowX":
                                        eventType = EventType.PlayerPickedUpFlag;
                                        break;
                                    case "blueflag_point": // run (the map) flag capture
                                    case "blueflag_point2":
                                    case "redflag_point":
                                    case "redflag_point2":
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerCapturedFlag;
                                        else
                                            console.error('unknown "run"-like trigger: ' + lineData);
                                        break;
                                    case 'rdet': // oppose2k1 water entrance det opened
                                    case 'bdet':
                                    case 'red_det': // 2mesa3 / stowaway2 water opened
                                    case 'blue_det':
                                    case 'rholedet': // cornfield cp4 / avanti
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerOpenedDetpackEntrance;
                                        else
                                            console.error('unknown rdet/bdet trigger: ' + lineData);
                                        break;
                                    case 'red_down': // schtop
                                    case 'blue_down':
                                        if (nonPlayerDataParts.length === 2)
                                            eventType = EventType.PlayerGotSecurity;
                                        else
                                            console.error('unknown red_down/blue_down trigger: ' + lineData);
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
                                        return;
                                    default:
                                        console.error(`unknown player trigger: ${nonPlayerDataParts[1]}: ${lineData}`);
                                }
                                break;
                            }
                    }
                } else {
                    // handle non-player log messages

                    // if no matches, must be a malformed line (crashed server?)
                    if (!nonPlayerDataParts || nonPlayerDataParts.length === 0)
                        return;
                    switch (nonPlayerDataParts[0]) {
                        case "Log":
                            if (nonPlayerDataParts[2] === "started")
                                eventType = EventType.StartLog;
                            else if (nonPlayerDataParts[2] === "closed")
                                eventType = EventType.EndLog;
                            else
                                console.error("Unknown 'log' message: " + lineData);
                            break;
                        case "Loading":
                            if (nonPlayerDataParts[1] === "map") {
                                eventType = EventType.MapLoading;
                                data.value = nonPlayerDataParts[2];
                            } else
                                console.error("unknown 'loading' command: " + lineData);
                            break;
                        case "Started":
                            if (nonPlayerDataParts[1] === "map") {
                                eventType = EventType.MapLoaded;
                                data.value = nonPlayerDataParts[2];
                            } else
                                console.error("unknown 'loading' command: " + lineData);
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
                                        console.error("unknown 'server cvars' command: " + lineData);
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
                                    console.error("unknown 'server' command: " + lineData);
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
                                playerToTeam = otherPlayerDataParts[4] !== "" ? this.parseTeam(otherPlayerDataParts[4]) : undefined;
                                playerTo = playerList.getPlayer(otherPlayerSteamID, otherPlayerName, otherPlayerID);
                            }
                            break;
                        case "World":
                            if (nonPlayerDataParts[1] !== "triggered") {
                                console.error("unknown 'World' command: " + lineData);
                                break;
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
                                case "Blue security is now operating!":
                                case "Red security is now operating!":
                                case "Blue security has been deactivated!":
                                case "Red security has been deactivated!":
                                case "Blue security will be operational in 30 seconds!": // schtop
                                case "Red security will be operational in 30 seconds!": // schtop
                                case "Blue_Flag_Vox":
                                case "Red_Flag_Vox":
                                case "#dustbowl_60_secs": // dustbowl / cornfield
                                case "#dustbowl_30_secs": // dustbowl / cornfield
                                case "#dustbowl_10_secs": // dustbowl / cornfield
                                case "defenders_score": // adl-specific score for time held (e.g., cornfield)
                                case "Command Point 4 Wall Breached": // cornfield (already handled by rholedet)
                                case "Command Point Four breached!": // avanti(?) (already handled by rholedet)
                                case "#italy_hole_text": // avanti (already handled by rholedet)
                                case "#rock_red_yard_opened": // crossover2 (already handled by rholedet)
                                case "The blue cave has been breached": // stowaway2 (already handled by 'blue_det')
                                case "The red cave has been breached": // stowaway2 (already handled by 'red_det')
                                case "#well_bgrate_destroyed": // 2mesa3 (already handled by "blue_det")
                                case "#well_rgrate_destroyed": // 2mesa3 (already handled by "red_det")
                                    return; // Ignore
                                default:
                                    console.log('unknown World trigger: ' + lineData);
                            }
                            break;
                        case "Team":
                            if (nonPlayerDataParts[2] !== "scored") {
                                console.error("unknown 'Team' command: " + lineData);
                                break;
                            }
                            eventType = EventType.TeamScore;
                            data.team = Event.parseTeam(nonPlayerDataParts[1]);
                            data.value = nonPlayerDataParts[3];
                            break;
                        case "[ETANA]":
                        case "[SUMMARY]": // dmg plugin summary
                            // TODO, log?
                            return;
                        case "<-1><><Blue>":
                        case "<-1><><Red>":
                        case "<-1><><Green>":
                        case "<-1><><Yellow>":
                            // frags that happen after the round ends
                            return;
                        default:
                            console.error('unknown non-player log message: ' + lineData);
                    }
                }
            }
            catch (error) {
                console.error(`\n\nFailed to parse line number ${lineNumber}: ${lineData}`);
                throw error;
            }

            if (eventType != null && timestamp) {
                return new Event({
                    eventType: eventType,
                    lineNumber: lineNumber,
                    timestamp: timestamp,
                    data: data,
                    playerFrom: playerFrom,
                    playerFromTeam: playerFromTeam,
                    playerTo: playerTo,
                    playerToTeam: playerToTeam,
                    withWeapon: withWeapon,
                });
            }
        } else {
            // invalid line; skip
            return;
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
            case "blue :d?": // destroy_l
            case "dustbowl_team1": // baconbowl
            case "attackers": // attac
                return TeamColor.Blue;
            case "red":
            case "red :d?": // destroy_l
            case "dustbowl_team2": // baconbowl
            case "defenders": // attac
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
            case "teledeath": // TODO: is this a spawn telefrag?
            case "teledeath (world)": // TODO: is this a spawn telefrag?
            case "door (world)": // TODO: door frag?
            case "door_rotating (world)": // haste_r
            case "world":
            case "worldspawn":
            case "worldspawn (world)":
            case "miniturret (world)": // TODO: call this out?
            case "the red lift (world)": // openfire
            case "the blue lift (world)": // openfire
            case "timer (world)": // getting killed after round ends (e.g. infection kill after time)
            case "normalgrenade (world)": // getting killed after round ends (e.g. suicide via grenade):
            case "mirvgrenade (world)":
            case "nailgrenade (world)":
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
