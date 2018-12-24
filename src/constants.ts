export interface OutputStats {
    log_name: string;
    map: string;
    server: string;
    date: string;
    time: string;
    game_time: string;
    players: OutputPlayerStats[];
}

export interface OutputPlayerStats {
    name: string;
    steam_id: string;
    kills: number;
    team_kills: number;
    sg_kills: number;
    deaths: number;
    suicides: number;
    team_deaths: number;
    concs: number;
    caps: number;
    touches: number;
    toss_percent: number;
    flag_time: string;
    obj: number;
    d_kills?: number;
    d_tk?: number;
    d_deaths?: number;
    d_team_deaths?: number;
    d_suicidies?: number;
}

// TODO: check `logs\L1125012.log` for others (like pills, tranq, knife, detpack, caltrop, etc.)
export enum Weapon {
    None = 0,
    NormalGrenade,
    NailGrenade,
    MirvGrenade,
    EmpGrenade,
    Supernails,
    Nails,
    Crowbar,
    Spanner,
    Medkit,
    Shotgun,
    SuperShotgun,
    Rocket,
    AutoCannon,
    Railgun,
    SentryGun,
    BuildingDispenser,
    BuildingSentryGun,
    GreenPipe,
    BluePipe,
    Detpack,
    Flames,
    NapalmGrenade,
    Caltrop,
    GasGrenade,
    Knife,
    Headshot,
    SniperRifle,
    AutoRifle,
    Infection,
    WorldSpawn, /* can we distinguish between world/fall dmg? */
    Train,
    Lasers,
    Pit,
};

export enum PlayerClass {
    Civilian = 0,
    Scout,
    Sniper,
    Soldier,
    Demoman,
    Medic,
    HWGuy,
    Pyro,
    Spy,
    Engineer,
};

export enum TeamColor {
    Blue = 1,
    Red,
    Yellow,
    Green,
    Spectator,
};

export namespace TeamColor {
    export function parseTeamColor(team: string): TeamColor {
        switch (team) {
            case "Blue":
                return TeamColor.Blue;
            case "Red":
                return TeamColor.Red;
            case "Yellow":
                return TeamColor.Yellow;
            case "Green":
                return TeamColor.Green
            case "Spectator":
                return TeamColor.Spectator;
            default:
                console.warn("unknown team received by `parseTeamColor`; assigning to spectator")
                return TeamColor.Spectator
        }
    }
}
