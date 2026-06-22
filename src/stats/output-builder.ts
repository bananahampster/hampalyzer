import type { Event } from "../models/event.js";
import EventType from "../models/event-types.js";
import PlayerList from "../models/player-list.js";
import Player from "../models/player.js";
import {
    DefenseTeamStats,
    DisplayStringHelper,
    EventDescriptor,
    FacetedStat,
    FacetedStatDetails,
    FacetedStatSummary,
    GenericStat,
    OffenseTeamStats,
    OutputStats,
    PlayerOutputStatsRound,
    StatDetails,
    TeamOutputStatsDetailed,
    TeamRole,
    TeamStats,
    TeamsOutputStatsDetailed,
    Weapon,
} from "../models/types.js";
import type { RoundState } from "../state/round-state.js";
import type { PlayersStats } from "./player-stats.js";

export function getPlayerFromTeams(steamId: string, teams: TeamsOutputStatsDetailed): PlayerOutputStatsRound | undefined {
    let foundPlayer: PlayerOutputStatsRound | undefined;
    for (const teamId in teams) {
        const team = teams[teamId] as TeamOutputStatsDetailed;
        foundPlayer = team.players.find(player => player.steamID === steamId);
        if (foundPlayer) {
            break;
        }
    }

    return foundPlayer;
}

export function generateOutputStats(
    roundState: RoundState,
    events: Event[],
    stats: PlayersStats,
    playerList: PlayerList,
    logfile: string,
): OutputStats {
    const mapEvent = events.find(event => event.eventType === EventType.MapLoading);
    const map = (mapEvent && mapEvent.value) || "(map not found)";

    const firstTimestamp = events[0].timestamp;
    const dayOfMonth = firstTimestamp.getDate();
    const month = Intl.DateTimeFormat("en-US", { month: "short" }).format(firstTimestamp);
    const year = firstTimestamp.getFullYear();
    const date = [dayOfMonth, month, year].join(" ");

    const time = Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(firstTimestamp);

    const serverEvent = events.find(event => event.eventType === EventType.ServerName);
    const server = (serverEvent && serverEvent.value) || "Unknown server";

    let serverShortName = server.split(/\s+/)[0];
    serverShortName = serverShortName.replace(/[\?\\/\*\"<>\|:]/g, "_");
    if (serverShortName.length > 10) {
        serverShortName = serverShortName.slice(0, 10);
    }
    const parse_name = [serverShortName, year, month, dayOfMonth, time.replace(":", "-")].join("-");

    const matchStartEvent = events.find(event => event.eventType === EventType.PrematchEnd) || events[0];
    const matchEndEvent = events.find(event => event.eventType === EventType.TeamScore) || events.at(-1)!;

    const gameTime = Intl.DateTimeFormat("en-US", { minute: "2-digit", second: "2-digit" }).format(
        matchEndEvent.timestamp.valueOf() - matchStartEvent.timestamp.valueOf(),
    );

    const teams = generateOutputTeamsStatsDetailed(stats, playerList, roundState.roundEndTimeInGameSeconds);

    let damageStatsExist = false;
    for (const teamId in teams) {
        const team = teams[teamId] as TeamOutputStatsDetailed;
        if ((team.teamStats?.damage_enemy && team.teamStats.damage_enemy > 0)
            || (team.teamStats?.damage_team && team.teamStats.damage_team > 0)) {
            damageStatsExist = true;
            break;
        }
    }

    return {
        parse_name,
        log_name: logfile,
        map,
        timestamp: firstTimestamp,
        date,
        time,
        game_time: gameTime,
        server,
        teams,
        score: roundState.score,
        scoring_activity: {
            flag_movements: roundState.teamFlagMovements,
            game_time_as_seconds: matchEndEvent.gameTimeAsSeconds ? matchEndEvent.gameTimeAsSeconds : 0,
        },
        damage_stats_exist: damageStatsExist,
    };
}

export function generateOutputTeamsStatsDetailed(
    stats: PlayersStats,
    players: PlayerList,
    gameEndTimeInGameSeconds: number,
): TeamsOutputStatsDetailed {
    const outputStats: TeamsOutputStatsDetailed = {};

    [1, 2].forEach(team => {
        const teamPlayerIDs = (players.teams[String(team)] as Player[])?.map(player => player.steamID) || [];
        const teamPlayers: PlayerOutputStatsRound[] = [];

        for (const playerID of teamPlayerIDs) {
            const poStats: PlayerOutputStatsRound = blankOutputPlayerStatsDetail(team);
            const thisPlayer = players.ensurePlayer(playerID, undefined, undefined, team) as Player;
            poStats.name = thisPlayer.name;
            poStats.steamID = playerID;
            poStats.id = thisPlayer.steamID.split(":")[2];

            const playerStats = stats[playerID];
            poStats.classes = thisPlayer.getPlayerClassTimes(gameEndTimeInGameSeconds);
            for (const stat in playerStats) {
                const statEvents = playerStats[stat];
                switch (stat) {
                    case "role":
                        poStats.roles = thisPlayer.getPlayerClassesDisplayString(gameEndTimeInGameSeconds);
                        break;
                    case "kill":
                        hydrateStat(poStats, thisPlayer, "kills", "kill", statEvents, "Enemy kills");
                        hydrateStat(
                            poStats,
                            thisPlayer,
                            "kills",
                            "kill_while_conced",
                            statEvents.filter(ev => ev.whileConced === true),
                            "Enemy kills while conced",
                        );
                        break;
                    case "team_kill":
                        hydrateStat(poStats, thisPlayer, "kills", "teamkill", statEvents, "Team kills");
                        break;
                    case "kill_sg":
                        hydrateStat(poStats, thisPlayer, "kills", "sg", statEvents, "Sentry gun kills");
                        break;
                    case "death":
                        hydrateStat(poStats, thisPlayer, "deaths", "death", statEvents, "Deaths by enemy");
                        break;
                    case "team_death":
                        hydrateStat(poStats, thisPlayer, "deaths", "by_team", statEvents, "Deaths by teammates");
                        break;
                    case "suicide":
                        hydrateStat(poStats, thisPlayer, "deaths", "by_self", statEvents, "Suicides");
                        break;
                    case "flag_pickup":
                        hydrateStat(poStats, thisPlayer, "objectives", "flag_touch", statEvents, "Flag touches");
                        break;
                    case "flag_capture":
                        hydrateStat(poStats, thisPlayer, "objectives", "flag_capture", statEvents, "Flag captures");
                        break;
                    case "got_button":
                        hydrateStat(poStats, thisPlayer, "objectives", "button", statEvents, "Got button / objective");
                        break;
                    case "det_entrance":
                        hydrateStat(poStats, thisPlayer, "objectives", "det_entrance", statEvents, "Det entrace");
                        break;
                    case "conc_jump":
                        hydrateStat(poStats, thisPlayer, "weaponStats", "concs", statEvents, "Conc jumps");
                        break;
                    case "airshot":
                        hydrateStat(poStats, thisPlayer, "weaponStats", "airshot", statEvents, "Airshot");
                        break;
                    case "airshoted":
                        hydrateStat(poStats, thisPlayer, "weaponStats", "airshoted", statEvents, "Got airshot (airshitted)");
                        break;
                    case "build_disp":
                        hydrateStat(poStats, thisPlayer, "buildables", "build_disp", statEvents, "Built dispensers");
                        break;
                    case "build_sg":
                        hydrateStat(poStats, thisPlayer, "buildables", "build_sg", statEvents, "Built sentry guns");
                        break;
                    case "damager":
                        hydrateStat(poStats, thisPlayer, "damage", "to_enemies", statEvents, "Damage dealt to enemies");
                        break;
                    case "damagee":
                        hydrateStat(poStats, thisPlayer, "damage", "from_enemies", statEvents, "Damage taken from enemies");
                        break;
                    case "team_damager":
                        hydrateStat(poStats, thisPlayer, "damage", "to_team", statEvents, "Damage dealt to teammates");
                        break;
                    case "team_damagee":
                        hydrateStat(poStats, thisPlayer, "damage", "from_team", statEvents, "Damage taken from teammates");
                        break;
                    case "self_damage":
                        hydrateStat(poStats, thisPlayer, "damage", "to_self", statEvents, "Damage dealt to self");
                        break;
                }
            }

            const [flag_time_in_seconds, toss_percent, touches_initial] = [
                thisPlayer.roundStats.flagCarryTimeInSeconds,
                thisPlayer.roundStats.flagCarries > 0
                    ? Math.round(thisPlayer.roundStats.flagThrows / thisPlayer.roundStats.flagCarries * 100)
                    : 0,
                thisPlayer.roundStats.flagInitialTouches,
            ];

            ensureStat(poStats, "objectives", "flag_time_in_seconds").value = flag_time_in_seconds;
            ensureStat(poStats, "objectives", "toss_percent").value = toss_percent;
            ensureStat(poStats, "objectives", "touches_initial").value = touches_initial;

            if (playerStats["flag_capture"]) {
                const capsWithBonus = playerStats["flag_capture"].filter(ev => ev.eventType === EventType.PlayerCapturedBonusFlag);
                hydrateStat(poStats, thisPlayer, "objectives", "flag_capture_bonus", capsWithBonus, "Flag captures with bonus");
            }

            teamPlayers.push(poStats);
        }

        teamPlayers.sort((a, b) => a.team === b.team ? (b.kills?.kill?.events?.length ?? 0) - (a.kills?.kill?.events?.length ?? 0) : 0);
        outputStats[team] = {
            players: teamPlayers,
            teamStats: generateOutputTeamStatsDetail(teamPlayers, team),
        };
    });

    return outputStats;
}

function generateOutputTeamStatsDetail(teamPlayers: PlayerOutputStatsRound[], team: number): TeamStats {
    const teamRole: TeamRole = team === 1 ? TeamRole.Offense : team === 2 ? TeamRole.Defense : TeamRole.Unknown;

    const stats = teamPlayers.reduce((aggregatedStats, player) => {
        aggregatedStats.frags += getSummarizedStat(player, "kills", "kill")
            - getSummarizedStat(player, "kills", "teamkill")
            + getSummarizedStat(player, "kills", "sg");

        aggregatedStats.kills += getSummarizedStat(player, "kills", "kill");
        aggregatedStats.team_kills += getSummarizedStat(player, "kills", "teamkill");
        aggregatedStats.conc_kills += getSummarizedStat(player, "kills", "kill_while_conced");

        aggregatedStats.deaths += getSummarizedStat(player, "deaths", "death")
            + getSummarizedStat(player, "deaths", "by_team")
            + getSummarizedStat(player, "deaths", "by_self");

        aggregatedStats.d_enemy += getSummarizedStat(player, "deaths", "death");
        aggregatedStats.d_self += getSummarizedStat(player, "deaths", "by_self");
        aggregatedStats.d_team += getSummarizedStat(player, "deaths", "by_team");
        aggregatedStats.damage_enemy += getSummarizedStat(player, "damage", "to_enemies");
        aggregatedStats.damage_team += getSummarizedStat(player, "damage", "to_team");

        switch (aggregatedStats.teamRole) {
            case TeamRole.Offense:
                aggregatedStats.sg_kills += getSummarizedStat(player, "kills", "sg");
                aggregatedStats.concs += getSummarizedStat(player, "weaponStats", "concs");
                aggregatedStats.caps += getSummarizedStat(player, "objectives", "flag_capture");
                aggregatedStats.caps_bonus += getSummarizedStat(player, "objectives", "flag_capture_bonus");
                aggregatedStats.touches += getSummarizedStat(player, "objectives", "flag_touch");
                aggregatedStats.touches_initial += getSummarizedStat(player, "objectives", "touches_initial");
                aggregatedStats.toss_percent += getSummarizedStat(player, "objectives", "toss_percent")
                    * getSummarizedStat(player, "objectives", "flag_touch");
                aggregatedStats.flag_time_in_seconds += getSummarizedStat(player, "objectives", "flag_time_in_seconds");
                break;
            case TeamRole.Defense:
                aggregatedStats.airshots += getSummarizedStat(player, "weaponStats", "airshot");
                break;
        }

        return aggregatedStats;
    }, blankTeamStats(teamRole));

    if (stats.teamRole === TeamRole.Offense && stats.touches > 0) {
        stats.toss_percent = Math.round(stats.toss_percent / stats.touches);
    }

    return stats;
}

function blankOutputPlayerStatsDetail(team: number = 5): PlayerOutputStatsRound {
    return {
        name: "(unknown)",
        roles: "(unknown)",
        team,
        steamID: "(unknown)",
        id: "unk",
        classes: [],
        deaths: {},
        kills: {},
        round_number: 0,
    };
}

function ensureStat<T = number>(
    playerStats: NonNullable<PlayerOutputStatsRound>,
    category: string,
    item: string,
    description?: string,
): GenericStat<any, T> {
    if (!playerStats[category]) {
        playerStats[category] = {};
    }

    if (!playerStats[category][item]) {
        const stat: GenericStat = {
            title: item,
            value: 0,
            events: [],
        };

        if (description) {
            stat.description = description;
        }

        playerStats[category][item] = stat;
    }

    return playerStats[category][item];
}

function hydrateStat(
    playerStats: PlayerOutputStatsRound,
    player: Player,
    category: string,
    item: string,
    events: Event[],
    description?: string,
): GenericStat {
    const thisStat = ensureStat(playerStats, category, item, description);
    thisStat.events = events;
    if (category !== "damage") {
        thisStat.value = events.length;

        const facetedStat = generateStatDetails(player, category, thisStat);
        if (facetedStat != null) {
            thisStat.weapon_summary = facetedStat.weapon_summary;
            thisStat.details = facetedStat.details;
        }
    } else {
        thisStat.value = 0;
        events.forEach(event => {
            thisStat.value += Number(event.data?.value);
        });

        const damageStats = generateDamageStats(player, thisStat);
        if (damageStats != null) {
            thisStat.details = damageStats.details;
        }
    }

    delete thisStat.events;
    return thisStat;
}

function generateDamageStats(player: Player, stat: GenericStat): FacetedStat | undefined {
    const events = stat.events;
    if (events == null) {
        return;
    }

    const facetedDetails: FacetedStatDetails = {};
    const perPlayerDamage = new Map<Player, number>();
    for (const event of events) {
        const otherPlayer: Player = player === event.playerTo ? event.playerFrom! : event.playerTo!;
        if (!perPlayerDamage.has(otherPlayer)) {
            perPlayerDamage.set(otherPlayer, 0);
        }
        perPlayerDamage.set(otherPlayer, perPlayerDamage.get(otherPlayer)! + Number(event.data?.value));
    }

    for (const playerDamage of perPlayerDamage) {
        const otherPlayer = playerDamage[0].name;
        if (!facetedDetails[otherPlayer]) {
            facetedDetails[otherPlayer] = [];
        }

        facetedDetails[otherPlayer].push({ value: playerDamage[1].toString() });
    }

    return { details: facetedDetails };
}

export function generateStatDetails(player: Player, category: string, stat: GenericStat): FacetedStat | undefined {
    const events = stat.events;
    if (events == null) {
        return;
    }

    switch (category) {
        case "kills":
            switch (stat.title) {
                case "kill":
                    return generateFacetedStats(stat.events!, e =>
                        `Killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${getTime(e)}`,
                    true);
                case "kill_while_conced":
                    return generateFacetedStats(stat.events!, e =>
                        `Killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} while conced at ${getTime(e)}`,
                    true);
                case "teamkill":
                    return generateFacetedStats(stat.events!, e =>
                        `Team killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${getTime(e)}`,
                    true);
                case "sg":
                    return generateFacetedStats(stat.events!, e => `Killed ${e.playerTo?.name}'s sentry gun at ${getTime(e)}`, true);
                default:
                    throw "generateStatDetails: not implemented";
            }
        case "deaths":
            switch (stat.title) {
                case "death":
                    return generateFacetedStats(stat.events!, e =>
                        `Killed ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${getTime(e)}`,
                    );
                case "by_team":
                    return generateFacetedStats(stat.events!, e =>
                        `Team-killed ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${getTime(e)}`,
                    );
                case "by_self":
                    return generateFacetedStats(stat.events!, e => {
                        const weaponString = e.withWeapon ? `with ${DisplayStringHelper.weaponToDisplayString(e.withWeapon)} ` : "";
                        return `Suicided ${weaponString}${e.playerToWasCarryingFlag ? "while carrying flag " : ""}at ${getTime(e)}`;
                    });
            }
            break;
        case "weaponStats":
            switch (stat.title) {
                case "airshot":
                    return generateFacetedStats(stat.events!, e =>
                        `Airshot ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${getTime(e)} (${e.data?.value} meters)`,
                    true);
                case "airshoted":
                    return generateFacetedStats(stat.events!, e =>
                        `Airshoted ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${getTime(e)} (${e.data?.value} meters)`,
                    );
                default:
                    console.log(`generateStatDetails: not implemented: weaponStats > ${stat.title}`);
            }
            break;
        case "damage":
            break;
        default:
            console.log(`generateStatDetails: not implemented: ${category} > ${stat.title}`);
    }
}

function generateFacetedStats(events: Event[], descriptor: EventDescriptor, isByPlayer?: boolean): FacetedStat {
    const facetedDetails = {};
    const facetedWeaponCounts: { [key in Weapon]?: number } = {};
    const allDetails: StatDetails[] = [];

    for (const event of events || []) {
        const statDetail: StatDetails = {
            player: isByPlayer ? event.playerTo : event.playerFrom,
            weapon: event.withWeapon,
        };

        const detailDescription = descriptor(event);
        if (detailDescription) {
            statDetail.description = detailDescription;
        }

        if (event.playerFrom?.team !== event.playerTo?.team && event.playerToWasCarryingFlag) {
            statDetail.cssClassToAdd = "weapon-highlight-good";
        } else if (event.playerToWasCarryingFlag) {
            statDetail.cssClassToAdd = "weapon-highlight-bad";
        }

        allDetails.push(statDetail);
    }

    for (const detail of allDetails) {
        const otherPlayer = detail.player?.name || "default";
        if (!facetedDetails[otherPlayer]) {
            facetedDetails[otherPlayer] = [];
        }

        const { player: _player, ...outputDetail } = detail;
        facetedDetails[otherPlayer].push(outputDetail);

        const weapon = detail.weapon || 0;
        if (!facetedWeaponCounts[weapon]) {
            facetedWeaponCounts[weapon] = 0;
        }

        facetedWeaponCounts[weapon]!++;
    }

    const facetedWeapon: FacetedStatSummary = {};
    for (const weapon_stat in facetedWeaponCounts) {
        const weapon_count = facetedWeaponCounts[weapon_stat];
        facetedWeapon[weapon_stat] = `${weapon_count} (${Math.round(weapon_count / events.length * 100)}%)`;
    }

    return { details: facetedDetails, weapon_summary: facetedWeapon };
}

function getTime(event: Event): string {
    return Intl.DateTimeFormat("en-us", { minute: "numeric", second: "2-digit" }).format(event.gameTimeAsSeconds! * 1000);
}

function getSummarizedStat(playerStats: PlayerOutputStatsRound, category: string, item: string): number {
    const statCategory = playerStats[category];
    if (statCategory) {
        return statCategory?.[item]?.value ?? 0;
    }

    return 0;
}

function blankTeamStats(teamRole: TeamRole = TeamRole.Unknown): TeamStats {
    const blankStats: TeamStats = {
        teamRole,
        frags: 0,
        kills: 0,
        team_kills: 0,
        conc_kills: 0,
        deaths: 0,
        d_enemy: 0,
        d_self: 0,
        d_team: 0,
        damage_enemy: 0,
        damage_team: 0,
    } as TeamStats;

    switch (blankStats.teamRole) {
        case TeamRole.Offense:
            blankStats.sg_kills = 0;
            blankStats.concs = 0;
            blankStats.caps = 0;
            blankStats.caps_bonus = 0;
            blankStats.touches = 0;
            blankStats.touches_initial = 0;
            blankStats.toss_percent = 0;
            blankStats.flag_time_in_seconds = 0;
            break;
        case TeamRole.Defense:
            blankStats.airshots = 0;
            break;
    }

    return blankStats;
}
