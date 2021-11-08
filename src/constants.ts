import { TeamScore, TeamComposition } from "./parserUtils";
import { Event } from './parser';
import Player from "./player";

export interface OutputStats {
    parse_name: string;  // 'user-friendly' URI slug
    log_name: string; // original log name as uploaded
    map: string;
    server: string;
    timestamp: Date;
    date: string;
    time: string;
    game_time: string;
    score: TeamScore;
    teams: TeamsOutputStatsDetailed;
    scoring_activity?: ScoringActivity;
}

// expected to be ordered by timestamp ascending
export type TeamFlagMovements = {
    [team in TeamColor]?: FlagMovement[];
 };

export interface ScoringActivity {
    flag_movements: TeamFlagMovements;
    game_time_as_seconds: number;
}

export interface FlagMovement {
    player: string; // steamID
    game_time_as_seconds: number,
    current_score: number,
    how_dropped: FlagDrop;
}

export const enum FlagDrop {
    Fragged = 0,
    Captured,
    Thrown,
}

export type TeamsOutputStatsDetailed = { [team in TeamColor]?: TeamOutputStatsDetailed; }

export interface TeamOutputStatsDetailed {
    players: PlayerOutputStatsRound[];
    teamStats?: TeamStats;
}

export interface OutputPlayer {
    team: number;
    name: string;
    steamID: string;
    id: string; // url-sanitized id
}

export interface PlayerOutputStats {
    name: string;
    steamID: string;
    team: number;
    id: string; // the url slug

    /** server metadata */
    map: string;
    server: string;
    date: string;
    time: string;
    players: TeamComposition<OutputPlayer>; // just to get other players to hydrate sidebar

    /** actual player stats, per round */
    round: PlayerOutputStatsRound[];
}

export interface PlayerOutputStatsRound extends OutputPlayer, PlayerStats {
    classes: ClassTime[];
    roles: string;
    round_number: number; // optional; 1-indexed
}

export interface PlayerStats {
    kills: { // frags, TK, sg kills
        kill?: GenericStat<'kill'>;
        kill_while_conced?: GenericStat<'kill_while_conced'>;
        teamkill?: GenericStat<'teamkill'>;
        sg?: GenericStat<'sg'>;
    };
    deaths: { // deaths, team-deaths, suicides
        death?: GenericStat<'death'>;
        by_team?: GenericStat<'by_team'>;
        by_self?: GenericStat<'by_self'>;
    };
    objectives?: { // flag touch, throw, capture, initial, security, detpak entrance opened, etc.
        touches_initial?: GenericStat<'touches_initial'>;
        flag_touch?: GenericStat<'flag_touch'>;
        flag_capture?: GenericStat<'flag_capture'>;
        flag_capture_bonus?: GenericStat<'flag_capture_bonus'>;
        flag_time?: GenericStat<'flag_time', string>;
        toss_percent?: GenericStat<'toss_percent'>;
        button?:  GenericStat<'button'>;
        det_entrance?: GenericStat<'det_entrance'>;
    };
    weaponStats?: { // passed infection, infected, detpack set/disarm, caltrop, hallucinate, airshot, concs, etc.
        concs?: GenericStat<'concs'>;
        airshot?: GenericStat<'airshot'>;
        airshoted?: GenericStat<'airshoted'>;
    };
    buildables?: { // sg build, upgrade, detonate, etc.
        build_sg?: GenericStat<'build_sg'>;
        build_disp?: GenericStat<'build_disp'>;
    };
}

export interface GenericStat<T = string, ValueType = number> extends FacetedStat {
    title: T;
    value: ValueType;
    description?: string;
    events?: Event[];
}

export interface FacetedStat { weapon_summary?: FacetedStatSummary, details?: FacetedStatDetails };

export type FacetedStatSummary = { [key in Weapon]?: string }; // { "1": "5 (65%)"" }
export type FacetedStatDetails = { [key: string]: StatDetails[] };
export type EventDescriptor = (ev: Event) => string;

export interface StatDetails {
    description: string;
    player?: Player;
    weapon?: Weapon;
    whileConced: boolean;
}

export interface ClassTime {
    class: PlayerClass;
    classAsString: string;
    time: string;
    startLineNumber: number;
    endLineNumber: number | null;
}

export type TeamStats = OffenseTeamStats | DefenseTeamStats | OtherTeamStats;

export interface ITeamStats {
    teamRole: TeamRole;
    frags: number;
    kills: number;
    team_kills: number;
    conc_kills: number;
    deaths: number;
    d_enemy: number;
    d_self: number;
    d_team: number;
}

export interface OffenseTeamStats extends ITeamStats {
    teamRole: TeamRole.Offense;
    team: number;
    sg_kills: number;
    concs: number;
    caps: number;
    caps_bonus: number;
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

export const enum TeamRole {
    Comparison = -2,
    Unknown = -1,
    Offense = 0,
    Defense = 1,
}

// TODO: check `logs\L1125012.log` for others (like pills, tranq, knife, detpack, caltrop, etc.)
// TODO: missing tranq
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
    Tranquilizer,
    BuildingTeleporter,
    BuildingTeleporterEntrance,
    BuildingTeleporterExit,
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
    Random,
};

export namespace PlayerClass {
    export function outputClass(playerClass: PlayerClass): string {
        switch(playerClass) {
            case PlayerClass.Civilian:
                return 'civilian';
            case PlayerClass.Scout:
                return 'scout';
            case PlayerClass.Sniper:
                return 'sniper';
            case PlayerClass.Soldier:
                return 'soldier';
            case PlayerClass.Demoman:
                return 'demoman';
            case PlayerClass.Medic:
                return 'medic';
            case PlayerClass.HWGuy:
                return 'hwguy';
            case PlayerClass.Pyro:
                return 'pyro';
            case PlayerClass.Spy:
                return 'spy';
            case PlayerClass.Engineer:
                return 'engineer';
            case PlayerClass.Random:
                return 'random';
            default:
                console.error(`unknown playerClass: outputClass(${playerClass})`);
                return 'unknown;'
        }
    }
}

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
    export function toString(teamColor: TeamColor): string {
        return (TeamColor as any)[teamColor];
    }
}
