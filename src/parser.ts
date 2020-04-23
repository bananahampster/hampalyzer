import * as fs from 'fs';
import EventType from './eventType';
import Player from './player';
import PlayerList from './playerList';
import { OutputStats, PlayerClass, TeamColor, Weapon, TeamStatsComparison, OutputPlayer } from './constants';
import ParserUtils, { TeamComposition } from './parserUtils';

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

        for (let event of this.allEvents) {
            const newEvent = Event.CreateEvent(event, this.players);
            if (newEvent)
                this.events.push(newEvent);
        }

        this.teamComp = ParserUtils.getPlayerTeams(this.events, this.players);
        const scores = ParserUtils.getScore(this.events);
        for (const team in this.teamComp) {
            const teamPlayers = this.teamComp[team];
            const score = scores[team];
            console.log(`Team ${team} (score ${score}) has ${teamPlayers.length} players: ${teamPlayers.join(', ')}.`);
        }

        // TODO: const flagStats = ParserUtils.generateFlagStats(this.events);
        const playerStats = ParserUtils.getPlayerStats(this.events, this.teamComp);
        this.summarizedStats = ParserUtils.generateOutputStats(this.events, playerStats, this.players, this.teamComp);
    }
}

export interface EventCreationOptions {
    eventType: EventType;
    timestamp: Date;
    data?: ExtraData;
    playerFrom?: Player;
    playerTo?: Player;
    withWeapon?: Weapon;
}

export class Event {
    public eventType: EventType;
    public timestamp: Date;

    public data?: ExtraData;
    public playerFrom?: Player;
    public playerTo?: Player;
    public withWeapon?: Weapon;

    constructor(options: EventCreationOptions) {
        // required fields
        this.eventType = options.eventType;
        this.timestamp = options.timestamp;
        
        // optional fields
        this.data = options.data;
        this.playerFrom = options.playerFrom;
        this.playerTo = options.playerTo;
        this.withWeapon = options.withWeapon;
    }

    public static CreateEvent(line: string, playerList: PlayerList): Event | undefined {
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
            let lineDataRE = /(\b[^\s]+\b)/ig

            // try to match player names
            let playerRE = /"([^"]*)<([0-9]+)><STEAM_([0-9:]+)><[a-z]*>"/ig
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
                                withWeapon = eventTextParts[1].indexOf('gl') ? Weapon.BluePipe : Weapon.Rocket;
                                data.value = withText.split(" ")[4];

                            } else if (eventTextParts[1] === "\"Concussion_Grenade\"") {
                                eventType = EventType.PlayerConced;

                            } else if (eventTextParts[1] === "\"Sentry_Destroyed\"") {
                                eventType = EventType.PlayerFraggedGun;
                                withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1] === `"Dispenser_Destroyed"`) {
                                eventType = EventType.PlayerFraggedDispenser;
                                withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1].startsWith(`"Sentry_Upgrade`)) {
                                eventType = EventType.PlayerUpgradedOtherGun;
                                data.level = Number(eventTextParts[1][eventTextParts[1].length - 1]);

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
                                        default:
                                            console.error('unknown player trigger Red/Blue: ' + eventText);
                                    }
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
                                data.value = parts[3];
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
                                if (parts.slice(3).join(' ') === "Flag Returned Message")
                                    eventType = EventType.FlagReturn;
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
            default:
                throw "undefined player class: " + playerClass;
        }
    }

    public static parseTeam(team: string): TeamColor {
        team = team.trim().toLowerCase();

        switch (team) {
            case "blue": 
                return TeamColor.Blue;
            case "red":
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
            case "detpack":
                return Weapon.Detpack;
            case "empgrenade":
                return Weapon.EmpGrenade;
            case "railgun":
                return Weapon.Railgun;
            case "flames":
                return Weapon.Flames;
            case "napalmgrenade":
                return Weapon.NapalmGrenade;
            case "caltrop":
                return Weapon.Caltrop;
            case "gasgrenade":
                return Weapon.GasGrenade;
            case "knife":
                return Weapon.Knife;
            case "headshot":
                return Weapon.Headshot;
            case "sniperrifle":
                return Weapon.SniperRifle;
            case "autorifle":
                return Weapon.AutoRifle;
            case "infection":
                return Weapon.Infection;
            case "world":
            case "worldspawn":
            case "worldspawn world":
                return Weapon.WorldSpawn;
            case "trigger_hurt":
            case "trigger_hurt world": // TODO: this could be a trigger at the bottom of a pit (shutdown) or world (orbit), how can we distinguish with fall damage?
            case "the red team's lasers world": // orbit_l3
            case "the blue team's lasers world": // orbit_l3
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