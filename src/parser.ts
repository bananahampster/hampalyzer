import * as fs from 'fs';
import EventType from './eventType';
import Player from './player';
import PlayerList from './playerList';
import { PlayerClass, TeamColor, Weapon } from './constants';

class Parser {
    private allData: string = "";
    private doneReading: boolean = false;
    private players: PlayerList = new PlayerList();

    private allEvents: string[] = [];
    public events: Event[] = [];

    constructor(private filename: string) { 
        // should probably check if the file exists here
    }

    public async parseFile(): Promise<void> {
        return new Promise<void>(resolve => { 
            const logStream = fs.createReadStream(this.filename);
            logStream.on('data', chunk => {
                this.allData += chunk;
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
        return this.allData;
    }

    private parseData(): void {
        this.allEvents = this.allData.split("\n");

        for (let event of this.allEvents) {
            this.events.push(new Event(event, this.players));
        }

        const kills = this.events.filter(event => event.eventType === EventType.PlayerFraggedPlayer)
            .reduce((acc, event) => {
                const playerFrom = event.playerFrom && event.playerFrom.steamID;
                if (playerFrom) {
                    if (!acc[playerFrom])
                        acc[playerFrom] = 0;

                    acc[playerFrom]++;
                }
                return acc;
            }, {});

        this.players.players.forEach(player => {
            console.log(`${player.name} killed ${kills[player.steamID]} players.`);
        });


    }
}

class Event {
    // TODO: top three should not be optional; should make required when parsing stable
    public eventType?: EventType;
    public timestamp?: Date;
    public data?: ExtraData;

    public playerFrom?: Player;
    public playerTo?: Player;
    public withWeapon?: Weapon;

    constructor(line: string, private playerList: PlayerList) {
        // a valid log line must start with 'L'
        if (line[0] === 'L') {
            // parse date
            let datePart = line.substr(2, 21);
            this.timestamp = new Date(datePart.replace(" - ", " "));

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

            this.data = {};

            // if there is a player match, we'll have multiple parts
            if (lineDataParts.length >= 2) {
                const playerName = lineDataParts[1];
                const playerID = Number(lineDataParts[2]);
                const playerSteamID = lineDataParts[3];

                this.playerFrom = this.playerList.getPlayer(playerSteamID, playerName, playerID);

                const eventText = lineDataParts[4].trim();

                // if there are six matches, two people were affected
                if (lineDataParts.length >= 7) {
                    const offendingPlayerName = lineDataParts[5];
                    const offendingPlayerID = Number(lineDataParts[6]);
                    const offendingPlayerSteamID = lineDataParts[7];

                    this.playerTo = this.playerList.getPlayer(offendingPlayerSteamID, offendingPlayerName, offendingPlayerID);

                    // do a switch based on the statement
                    const withText = lineDataParts[8].trim();

                    const eventTextParts = eventText.split(" ");
                    switch (eventTextParts[0]) {
                        case "killed":
                            if (withText.startsWith("with")) {
                                this.eventType = EventType.PlayerFraggedPlayer;
                                this.withWeapon = Event.parseWeapon(withText);

                            } else
                                console.log("Unknown 'killed' event: " + line);
                            break;
                        case "triggered": 
                            if (eventTextParts[1] === "\"Concussion_Grenade\"") {
                                this.eventType = EventType.PlayerConced;

                            } else if (eventTextParts[1] === "\"Sentry_Destroyed\"") {
                                this.eventType = EventType.PlayerFraggedGun;
                                this.withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1] === `"Dispenser_Destroyed"`) {
                                this.eventType = EventType.PlayerFraggedDispenser;
                                this.withWeapon = Event.parseWeapon(withText);

                            } else if (eventTextParts[1].startsWith(`"Sentry_Upgrade`)) {
                                this.eventType = EventType.PlayerUpgradedOtherGun;
                                // TODO: to what level?

                            } else if (eventTextParts[1] === `"Detpack_Disarmed"`) {
                                this.eventType = EventType.PlayerDetpackDisarm;

                            } else if (eventTextParts[1] === `"Medic_Heal"`) {
                                this.eventType = EventType.PlayerHeal;

                            } else if (eventTextParts[1] === `"Caltrop_Grenade"`) {
                                this.eventType = EventType.PlayerCaltroppedPlayer;

                            } else if (eventTextParts[1] === `"Spy_Tranq"`) {
                                this.eventType = EventType.PlayerTranqedPlayer;
                                
                            } else if (eventTextParts[1] === `"Hallucination_Grenade"`) {
                                this.eventType = EventType.PlayerHallucinatedPlayer;

                            } else if (eventTextParts[1] === `"Medic_Infection"`) {
                                this.eventType = EventType.PlayerInfectedPlayer;
                            
                            } else if (eventTextParts[1] === `"Passed_On_Infection"`) {
                                this.eventType = EventType.PlayerPassedInfection;
                                
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
                            this.eventType = parts[0] === "say_team" ? EventType.PlayerMM2 : EventType.PlayerMM1;
                            const firstQuote = eventText.search('"');
                            let text = eventText.slice(firstQuote + 1);

                            // remove the last quote, if it exists
                            if (text[text.length - 1] === '"')
                                text = text.slice(0, text.length - 1).trim();

                            this.data.value = text;
                            break;
                        case "joined":
                            this.eventType = EventType.PlayerJoinTeam;
                            this.data.team = Event.parseTeam(parts[2]);
                            break;
                        case "entered":
                            this.eventType = EventType.PlayerJoinServer;
                            break;
                        case "changed": 
                            this.eventType = EventType.PlayerChangeRole;
                            this.data.class = Event.parseClass(parts[3]);
                            break;
                        case "committed": // TODO: sometimes this line has extra data
                        /* e.g., L 11/20/2018 - 01:54:42: "phone<59><STEAM_0:0:44791068><Blue>" committed suicide with "trigger_hurt" (world); L 11/20/2018 - 01:46:41: "pheesh-L7<64><STEAM_0:0:64178><Red>" committed suicide with "train" (world); "tomaso<19><STEAM_0:0:7561319><Blue>" committed suicide with "the red team's lasers" (world) */
                            this.eventType = EventType.PlayerCommitSuicide;
                            this.withWeapon = Event.parseWeapon(parts.slice(3).join(' '));
                            break;
                        case "triggered":
                            switch (parts[1]) {
                                case "info_player_teamspawn":
                                    this.eventType = EventType.PlayerSpawn;
                                    break;
                                case "Sentry_Built_Level_1":
                                    this.eventType = EventType.PlayerBuiltSentryGun;
                                    break;
                                case "Sentry_Upgrade_Level_2":
                                    this.eventType = EventType.PlayerUpgradedGun;
                                    this.data.level = 2;
                                    break;
                                case "Sentry_Upgrade_Level_3":
                                    this.eventType = EventType.PlayerUpgradedGun;
                                    this.data.level = 3;
                                    break;
                                case "Sentry_Repair":
                                    this.eventType = EventType.PlayerRepairedBuilding;
                                    this.data.building = Event.parseWeapon("sentrygun");
                                    break;
                                case "Built_Dispenser":
                                    this.eventType = EventType.PlayerBuiltDispenser;
                                    break;
                                case "Dispenser_Destroyed":
                                    this.eventType = EventType.PlayerDetonatedBuilding;
                                    this.data.building = Event.parseWeapon("dispenser");
                                    break;
                                case "Sentry_Destroyed":
                                    this.eventType = EventType.PlayerDetonatedBuilding;
                                    this.data.building = Event.parseWeapon("sentrygun");
                                    break;
                                case "Sentry_Dismantle":
                                    this.eventType = EventType.PlayerDismantledBuilding;
                                    this.data.building = Event.parseWeapon("sentrygun");
                                    break;
                                case "Detpack_Set":
                                    this.eventType = EventType.PlayerDetpackSet;
                                    break;
                                case "Detpack_Explode":
                                    this.eventType = EventType.PlayerDetpackExplode;
                                    break;
                                case "goalitem":
                                    if (parts.length === 2)
                                        this.eventType = EventType.PlayerPickedUpFlag;
                                    else
                                        console.error('unknown player trigger "goalitem": ' + eventText);
                                    break;
                                case "Red": 
                                case "Blue":
                                    switch (parts[2]) {
                                        case "Flag":
                                            this.eventType = EventType.PlayerPickedUpFlag;
                                            break;
                                        case "Cap":
                                            if (parts[3] === "Point") // monkey_l
                                                this.eventType = EventType.PlayerCapturedFlag;
                                            else if (parts.length === 3) // waterwar
                                                this.eventType = EventType.PlayerCapturedFlag;
                                            else
                                                console.error('unknown player trigger "Red/Blue Cap": ' + eventText);
                                            break;
                                        case "Capture":
                                            if (parts[3] === "Point") // orbit_l3
                                                this.eventType = EventType.PlayerCapturedFlag;
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
                                            this.eventType = EventType.PlayerCapturedFlag;
                                            break;
                                        default:
                                            console.error('unknown player trigger Team (len 3): ' + eventText);
                                    }
                                    break;
                                case "t1df": // oppose2k1 flag dropoff (TODO: is this team-specific?)
                                    if (parts.length === 2)
                                        this.eventType = EventType.PlayerCapturedFlag;
                                    else
                                        console.error('unknown t1df trigger: ' + eventText);
                                    break;
                                case 'rdet': // oppose2k1 water entrance det opened
                                case 'bdet':
                                case 'red_det': // 2mesa3 water opened
                                case 'blue_det': 
                                    if (parts.length === 2)
                                        this.eventType = EventType.PlayerOpenedDetpackEntrance;
                                    else
                                        console.error('unknown rdet/bdet trigger: ' + eventText);
                                    break;
                                case 'red_down': // schtop
                                case 'blue_down':
                                    if (parts.length === 2)
                                        this.eventType = EventType.PlayerGotSecurity;
                                    else
                                        console.error('unknown red_down/blue_down trigger: ' + eventText);
                                    break;
                                case 'red_up': // schtop
                                case 'blue_up':
                                    if (parts.length === 2) {
                                        this.eventType = EventType.SecurityUp;
                                        const team = parts[1] === 'red_up' ? "red" : "blue";
                                        this.data.team = Event.parseTeam(team);
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
                switch (parts[0]) {
                    case "Log": 
                        if (parts[2] === "started")
                            this.eventType = EventType.StartLog;
                        else if (parts[2] === "closed")
                            this.eventType = EventType.EndLog;
                        else 
                            console.error("Unknown 'log' message: " + lineData);
                        break;
                    case "Loading":
                        if (parts[1] === "map") {
                            this.eventType = EventType.MapLoading;
                            this.data.value = parts[2];
                        } else
                            console.error("unknown 'loading' command: " + lineData);
                        break;
                    case "Started":
                        if (parts[1] === "map") {
                            this.eventType = EventType.MapLoaded;
                            this.data.value = parts[2];
                        } else
                            console.error("unknown 'loading' command: " + lineData);
                        break;
                    case "Server":
                        switch (parts[1]) {
                            case "name":
                                this.eventType = EventType.ServerName;
                                this.data.value = parts[3];
                                break;
                            case "cvars":
                                if (parts[2] === "start")
                                    this.eventType = EventType.ServerCvarStart;
                                else if (parts[2] === "end")
                                    this.eventType = EventType.ServerCvarEnd
                                else 
                                    console.error("unknown 'server cvars' command: " + lineData);
                                break;
                            case "cvar":
                                this.eventType = EventType.ServerCvar;
                                this.data.key = parts[2];
                                this.data.value = parts[3];
                                break;
                            default:
                                console.error("unknown 'server' command: " + lineData);
                        }
                        break;
                    case "Rcon":
                        this.eventType = EventType.RconCommand;
                        this.data.value = parts.slice(4).join(' ');
                        break;
                    case "World":
                        if (parts[1] !== "triggered") {
                            console.error("unknown 'World' command: " + lineData);
                            break;
                        }
                        switch (parts[2]) {
                            case "Match_Begins_Now":
                                this.eventType = EventType.PrematchEnd;
                                break;
                            case "Red": 
                            case "Blue":
                                if (parts.slice(3).join(' ') === "Flag Returned Message")
                                    this.eventType = EventType.FlagReturn;
                                else 
                                    console.log('unknown World "Red/Blue ..." trigger: ' + lineData);
                                break;
                            case 'never': // TODO: normalize this a little across maps
                                this.eventType = EventType.WorldTrigger;

                                let lastIndex = lineData.lastIndexOf('"');
                                if (lastIndex === lineData.length - 1)
                                    this.data.value = lineData.slice(lineData.lastIndexOf('"', lineData.length - 2), lineData.length - 1);
                                else 
                                    this.data.value = lineData.slice(lastIndex);
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
                        this.eventType = EventType.TeamScore;
                        this.data.team = Event.parseTeam(parts[1])
                        this.data.value = parts[3];
                        break;
                    default:
                        console.error('unknown non-player log message: ' + lineData);
                }
            }
        }
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
        team = team.trim();

        switch (team) {
            case "Blue": 
                return TeamColor.Blue;
            case "Red":
                return TeamColor.Red;
            case "Yellow":
                return TeamColor.Yellow;
            case "Green":
                return TeamColor.Green;
            case "SPECTATOR":
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