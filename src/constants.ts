import { TeamScore } from "./parserUtils";

export interface OutputStats {
    log_name: string;
    map: string;
    server: string;
    date: string;
    time: string;
    game_time: string;
    score: TeamScore;
    teams: TeamsOutputStats;
}

export type TeamsOutputStats = { [team in TeamColor]?: TeamOutputStats; }

export interface TeamOutputStats { 
    players: OutputPlayerStats[];
    teamStats?: TeamStats;
}

export interface OutputStatsFullGame extends OutputStats {
    players: OutputPlayerStatsFullGame[];
}

export interface OutputPlayer {
    team: number;
    name: string;
    steamID: string;
}

export interface OutputPlayerStats extends OutputPlayer {
    roles: string;
    kills: number;
    team_kills: number;
    sg_kills: number;
    deaths: number;
    suicides: number;
    team_deaths: number;
    concs: number;
    caps: number;
    touches: number;
    touches_initial: number;
    toss_percent: number;
    flag_time: string;
    obj: number;
    // TODO: unused
    d_kills?: number;
    d_tk?: number;
    d_deaths?: number;
    d_team_deaths?: number;
    d_suicidies?: number;
}

export type TeamStats = OffenseTeamStats | DefenseTeamStats | OtherTeamStats;

export interface ITeamStats {
    teamRole: TeamRole;
    frags: number;
    kills: number;
    team_kills: number;
    deaths: number;
    d_enemy: number;
    d_self: number;
    d_team: number;
}

export interface OffenseTeamStats extends ITeamStats {
    teamRole: TeamRole.Offsense;
    team: number;
    sg_kills: number;
    concs: number;
    caps: number;
    touches: number;
    touches_initial: number;
    toss_percent: number;
    flag_time: string;
    obj?: number;
}

export interface DefenseTeamStats extends ITeamStats {
    teamRole: TeamRole.Defense;
    team: number;
    airshots: number;
}

export interface OtherTeamStats extends ITeamStats {
    teamRole: TeamRole.Unknown;
 }

 export type TeamStatsComparison = [OffenseTeamStats, DefenseTeamStats];

export interface OutputPlayerStatsFullGame extends OutputPlayerStats {
    rd2_kills: number;
    rd2_team_kills: number;
    rd2_sg_kills: number;
    rd2_deaths: number;
    rd2_suicides: number;
    rd2_team_deaths: number;
    rd2_concs: number;
    rd2_caps: number;
    rd2_touches: number;
    rd2_toss_percent: number;
    rd2_flag_time: string;
    rd2_obj: number;
}

export const enum TeamRole {
    Comparison = -2,
    Unknown = -1,
    Offsense = 0,
    Defense = 1,
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
