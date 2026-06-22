import type { Event } from "../models/event.js";
import EventType from "../models/event-types.js";
import Player from "../models/player.js";
import { Weapon } from "../models/types.js";

export type Stats = { [stat: string]: Event[] };
export type PlayersStats = { [playerID: string]: Stats } & { flag: Stats };

export function generatePlayerStats(events: Event[]): PlayersStats {
    const playerStats: PlayersStats = { flag: {} };
    for (const event of events) {
        if (!event.playerFrom) {
            switch (event.eventType) {
                case EventType.FlagReturn:
                    addStat(playerStats.flag, "flag_return", event);
                    break;
            }
            continue;
        }

        const thisPlayer = event.playerFrom;
        const thisPlayerStats = getPlayerFromStats(playerStats, thisPlayer);

        if (!event.playerTo) {
            switch (event.eventType) {
                case EventType.PlayerBuiltDispenser:
                    addStat(thisPlayerStats, "build_disp", event);
                    break;
                case EventType.PlayerBuiltSentryGun:
                    addStat(thisPlayerStats, "build_sg", event);
                    break;
                case EventType.PlayerBuiltTeleporter:
                    addStat(thisPlayerStats, "build_tele", event);
                    break;
                case EventType.PlayerCapturedArenaCenter:
                case EventType.PlayerCapturedArenaOpponent:
                case EventType.PlayerCapturedArenaOwn: {
                    let syntheticCaptureCount = 1;
                    if (event.eventType === EventType.PlayerCapturedArenaCenter) {
                        syntheticCaptureCount = 3;
                    } else if (event.eventType === EventType.PlayerCapturedArenaOpponent) {
                        syntheticCaptureCount = 10;
                    }

                    for (let i = 0; i < syntheticCaptureCount; i++) {
                        addStat(thisPlayerStats, "flag_pickup", event);
                        addStat(playerStats.flag, "flag_pickup", event);
                        addStat(thisPlayerStats, "flag_capture", event);
                        addStat(playerStats.flag, "flag_capture", event);
                    }
                    break;
                }
                case EventType.PlayerCapturedFlag:
                case EventType.PlayerCapturedBonusFlag:
                case EventType.PlayerCapturedPoint:
                    addStat(thisPlayerStats, "flag_capture", event);
                    addStat(playerStats.flag, "flag_capture", event);
                    break;
                case EventType.PlayerChangeRole:
                    addStat(thisPlayerStats, "role", event);
                    break;
                case EventType.PlayerConced:
                    throw "Concussion grenade event didn't contain a second player";
                case EventType.PlayerDetonatedBuilding:
                    addStat(thisPlayerStats, "det_building", event);
                    break;
                case EventType.PlayerDetpackExplode:
                    addStat(thisPlayerStats, "detpack_explode", event);
                    break;
                case EventType.PlayerDetpackSet:
                    addStat(thisPlayerStats, "detpack_set", event);
                    break;
                case EventType.PlayerDismantledBuilding:
                    addStat(thisPlayerStats, "dismantle_building", event);
                    break;
                case EventType.PlayerGotSecurity:
                    addStat(thisPlayerStats, "got_button", event);
                    break;
                case EventType.PlayerOpenedDetpackEntrance:
                    addStat(thisPlayerStats, "det_entrance", event);
                    break;
                case EventType.PlayerPickedUpFlag:
                    addStat(thisPlayerStats, "flag_pickup", event);
                    addStat(playerStats.flag, "flag_pickup", event);
                    break;
                case EventType.PlayerPickedUpBonusFlag:
                    addStat(thisPlayerStats, "flag_bonus_pickup", event);
                    break;
                case EventType.PlayerThrewFlag:
                    addStat(thisPlayerStats, "flag_throw", event);
                    addStat(playerStats.flag, "flag_throw", event);
                    break;
                case EventType.PlayerRepairedBuilding:
                    addStat(thisPlayerStats, "repair_building", event);
                    break;
                case EventType.PlayerUpgradedGun:
                    addStat(thisPlayerStats, "upgrade_building", event);
                    break;
                case EventType.PlayerMM1:
                case EventType.PlayerMM2:
                    addStat(thisPlayerStats, "chat", event);
                    break;
                case EventType.PlayerSpawn:
                case EventType.PlayerJoinServer:
                case EventType.PlayerChangedName:
                case EventType.PlayerLeftServer:
                case EventType.SecurityUp:
                case EventType.PlayerGainedFlagWithLocation:
                case EventType.PlayerDroppedFlagViaDeathWithLocation:
                    break;
                default:
                    console.log(`didn't log event id ${EventType[event.eventType]} for ${thisPlayer.name}.`);
            }
        } else {
            const otherPlayer = event.playerTo;
            const otherPlayerStats = getPlayerFromStats(playerStats, otherPlayer);

            switch (event.eventType) {
                case EventType.PlayerFraggedPlayer:
                    if (event.withWeapon === Weapon.None) {
                        break;
                    }

                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_kill", event);
                        addStat(otherPlayerStats, "team_death", event);
                    } else {
                        addStat(thisPlayerStats, "kill", event);
                        addStat(otherPlayerStats, "death", event);
                    }
                    break;
                case EventType.PlayerCaltroppedPlayer:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_caltroper", event);
                        addStat(otherPlayerStats, "team_caltroppee", event);
                    } else {
                        addStat(thisPlayerStats, "caltropper", event);
                        addStat(otherPlayerStats, "caltroppee", event);
                    }
                    break;
                case EventType.PlayerConced:
                    if (thisPlayer === otherPlayer) {
                        addStat(thisPlayerStats, "conc_jump", event);
                    } else if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "conc_team", event);
                        addStat(otherPlayerStats, "team_concee", event);
                    } else {
                        addStat(thisPlayerStats, "conc_enemy", event);
                        addStat(otherPlayerStats, "concee", event);
                    }
                    break;
                case EventType.PlayerDetpackDisarm:
                    addStat(thisPlayerStats, "detpack_disarmer", event);
                    addStat(otherPlayerStats, "detpack_disarmee", event);
                    break;
                case EventType.PlayerFraggedDispenser:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_kill_disp", event);
                        addStat(otherPlayerStats, "team_die_disp", event);
                    } else {
                        addStat(thisPlayerStats, "kill_disp", event);
                        addStat(otherPlayerStats, "die_disp", event);
                    }
                    break;
                case EventType.PlayerFraggedGun:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_kill_sg", event);
                        addStat(otherPlayerStats, "team_die_sg", event);
                    } else {
                        addStat(thisPlayerStats, "kill_sg", event);
                        addStat(otherPlayerStats, "die_sg", event);
                    }
                    break;
                case EventType.PlayerHallucinatedPlayer:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_piller", event);
                        addStat(otherPlayerStats, "team_pillee", event);
                    } else {
                        addStat(thisPlayerStats, "piller", event);
                        addStat(otherPlayerStats, "pillee", event);
                    }
                    break;
                case EventType.PlayerHeal:
                    addStat(thisPlayerStats, "healer", event);
                    addStat(otherPlayerStats, "healee", event);
                    break;
                case EventType.PlayerHitAirshot:
                    addStat(thisPlayerStats, "airshot", event);
                    addStat(otherPlayerStats, "airshoted", event);
                    break;
                case EventType.PlayerInfectedPlayer:
                    addStat(thisPlayerStats, "infecter", event);
                    addStat(otherPlayerStats, "infectee", event);
                    break;
                case EventType.PlayerPassedInfection:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_pass_infecter", event);
                        addStat(otherPlayerStats, "team_pass_infectee", event);
                    } else {
                        addStat(thisPlayerStats, "pass_infecter", event);
                        addStat(otherPlayerStats, "pass_infectee", event);
                    }
                    break;
                case EventType.PlayerTranqedPlayer:
                    if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_tranqer", event);
                        addStat(otherPlayerStats, "team_tranqee", event);
                    } else {
                        addStat(thisPlayerStats, "tranqer", event);
                        addStat(otherPlayerStats, "tranqee", event);
                    }
                    break;
                case EventType.PlayerUpgradedOtherGun:
                    addStat(thisPlayerStats, "team_building_repairer", event);
                    addStat(otherPlayerStats, "team_building_repairee", event);
                    break;
                case EventType.PlayerDamage:
                    if (thisPlayer === otherPlayer) {
                        addStat(thisPlayerStats, "self_damage", event);
                    } else if (event.playerFrom.team === event.playerTo.team) {
                        addStat(thisPlayerStats, "team_damager", event);
                        addStat(otherPlayerStats, "team_damagee", event);
                    } else {
                        addStat(thisPlayerStats, "damager", event);
                        addStat(otherPlayerStats, "damagee", event);
                    }
                    break;
                case EventType.PlayerCommitSuicide:
                    addStat(thisPlayerStats, "suicide", event);
                    break;
                case EventType.PlayerJoinTeam:
                case EventType.PlayerLeftServer:
                    break;
                default:
                    console.warn(`didn't count event id ${EventType[event.eventType]} for ${thisPlayer.name} against ${otherPlayer.name}`);
            }
        }
    }

    return playerStats;
}

function addStat(stats: Stats, key: string, event: Event): void {
    if (!stats[key]) {
        stats[key] = [];
    }

    stats[key].push(event);
}

function getPlayerFromStats(playersStats: PlayersStats, player: Player): Stats {
    let thisPlayerStats = playersStats[player.steamID];
    if (!thisPlayerStats) {
        thisPlayerStats = playersStats[player.steamID] = {};
    }

    return thisPlayerStats;
}
