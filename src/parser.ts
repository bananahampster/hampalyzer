import * as fs from 'fs';

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
    }
}

export enum EventType {
    StartLog,
    MapLoading,
    ServerCvarStart,
    ServerCvar,
    ServerCvarEnd,
    ServerName,
    MapLoaded,
    PlayerJoinTeam,
    PlayerJoinServer,
    PlayerChangeRole,
    PlayerCommitSuicide,
    PlayerMM1,
    PlayerMM2,
    PlayerFraggedPlayer, /* done */
    RconCommand,
    ServerSay,
    WorldTrigger,
    PrematchEnd,
    PlayerSpawn,
    PlayerConced, /* done */
    PlayerFraggedGun, /* done */
    PlayerFraggedDispenser, /* done */
    PlayerDetpackSet,
    PlayerDetpackExplode,
    PlayerDetpackDisarm, /* done, not verified */
    PlayerUpgradedGun,
    PlayerUpgradedOtherGun, /* done, not verified */
    PlayerBuiltSentryGun,
    PlayerBuiltDispenser,
    PlayerBuiltTeleporter,
    PlayerDetonatedBuilding,
    PlayerDismantledBuilding,
    PlayerHeal, /* done */
    TeamScore,
    MetaModMessages,
    EndLog,
};

export enum Weapon {
    NormalGrenade,
    NailGrenade,
    MirvGrenade,
    EmpGrenade,
    Supernails,
    Nails,
    Crowbar,
    Shotgun,
    SuperShotgun,
    Rocket,
    Railgun,
    SentryGun,
    BuildingDispenser,
    BuildingSentryGun,
    GreenPipe,
    BluePipe,
    Detpack,
}

class Event {
    // TODO: top three should not be optional; should make required when parsing stable
    public eventType?: EventType;
    public timestamp?: Date;
    public data?: string[];

    public playerFrom?: Player;
    public playerTo?: Player;
    public withWeapon?: Weapon;
    public extraData?: string; /** holds sentry levels */

    constructor(line: string, private playerList: PlayerList) {
        // a valid log line must start with 'L'
        if (line[0] === 'L') {
            // parse date
            let datePart = line.substr(2, 21);
            this.timestamp = new Date(datePart.replace(" - ", " "));

            // figure out the type of event (TODO)
            const lineData = line.substr(25);

            // try to match player names
            let playerRE = /"([^"]*)<([0-9]+)><STEAM_([0-9:]+)><[a-z]+>"/ig
            const lineDataParts = lineData.split(playerRE);

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

                            } else if (eventTextParts[1] === `"Detpack_Disarmed"`) {
                                this.eventType = EventType.PlayerDetpackDisarm;

                            } else if (eventTextParts[1] === `"Medic_Heal"`) {
                                this.eventType = EventType.PlayerHeal;

                            } else {
                                console.log("unknown 'triggered' event: " + line);
                                throw ""; // TODO
                            }
                            break;
                        default:
                            console.log("Unknown multi-player event: " + line);
                            throw ""; // TODO
                    }
                }
            }
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
                return Weapon.Supernails;
            case "nails":
                return Weapon.Nails;
            case "crowbar":
                return Weapon.Crowbar;
            case "shotgun":
                return Weapon.Shotgun;
            case "supershotgun":
                return Weapon.SuperShotgun;
            case "rocket":
                return Weapon.Rocket;
            case "sentrygun":
                return Weapon.SentryGun;
            case "pipebomb":
                return Weapon.GreenPipe;
            case 'gl_grenade':
                return Weapon.BluePipe;
            case "building_dispenser":
                return Weapon.BuildingDispenser;
            case "building_sentrygun":
                return Weapon.BuildingSentryGun;
            case "detpack":
                return Weapon.Detpack;
            case "empgrenade":
                return Weapon.EmpGrenade;
            case "railgun":
                return Weapon.Railgun;
            default:
                throw "unknown weapon: " + weapon;
        }
    }
}

class Player {
    private steamNum: string;
    private names: string[];
    private playerNum: number;

    constructor(steamID: string, name: string, playerID: number) {
        this.steamNum = steamID;
        this.names = [name];
        this.playerNum = playerID;
    }

    public addName(name: string): void {
        if (this.names.indexOf(name) === -1)
            this.names.push(name);
    }

    // return the last name??
    public get name(): string {
        return name[this.names.length - 1];
    }

    public get steamID(): string {
        return "STEAM_" + this.steamNum;
    }

    public get playerID(): number { 
        return this.playerNum;
    }

    public toString(): string {
        return this.name;
    }
}

class PlayerList {
    private players: Player[];
    private teams: number[];

    constructor() {
        this.players = [];
        this.teams = [];
    }

    public getPlayer(steamID: string, name: string, playerID: number): Player {
        const playerIndex = this.playerExistsAtIndex(steamID);
        if (playerIndex !== -1)
            return this.players[playerIndex];

        const newPlayer = new Player(steamID, name, playerID);
        this.players.push(newPlayer);
        return newPlayer;
    }

    public getPlayerNum(player: Player): number {
        const playerIndex = this.playerExistsAtIndex(player.steamID);
        
        if (playerIndex === -1) {
            this.players.push(player);
            return this.players.length - 1;
        } else {
            return playerIndex;
        }
    }

    // TODO: set players' teams
    private playerExistsAtIndex(steamID: string): number { 
        if (!steamID.startsWith("STEAM"))
            steamID = "STEAM_" + steamID;
            
        let foundIndex = -1;
        this.players.some((curPlayer, i) => {
            if (curPlayer.steamID === steamID) {
                foundIndex = i;
                return true;
            }

            return false;
        });

        return foundIndex;
    }
}

export default Parser;