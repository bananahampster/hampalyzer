import PlayerList from "./playerList.js";
import { Event, RoundParser } from "./parser.js";
import Player from "./player.js";
import { RoundState } from "./roundState.js";
import { TeamColor, TeamComposition, OutputStats, DisplayStringHelper, PlayerClass, TeamStatsComparison, TeamRole, TeamStats, OffenseTeamStats, DefenseTeamStats, OutputPlayer, PlayerOutputStatsRound, TeamsOutputStatsDetailed, GenericStat, ClassTime, TeamOutputStatsDetailed, StatDetails, FacetedStat, EventDescriptor, Weapon, FacetedStatSummary, TeamFlagMovements, FlagMovement, FlagDrop, FacetedStatDetails } from "./constants.js";
import EventType from "./eventType.js";

export type TeamScore = { [team in TeamColor]?: number; };
export type PlayersStats = { [playerID: string]: Stats } & { 'flag': Stats };
export type Stats = { [stat: string]: Event[] };

export default class ParserUtils {
    public static getFilteredPlayers(roundState: RoundState): PlayerList {
        // TODO: filter out spectators and players with 0 round time on a team
        const filteredList = new PlayerList();
        for (const [team, players] of Object.entries(roundState.players.teams)) {
            if (players) {
                players.forEach((player: Player) => {
                    if (player.team !== TeamColor.Spectator && player.getTotalRoundTimeInSeconds(roundState.roundEndTimeInGameSeconds) > 0) {
                        filteredList.addPlayer(player);
                    }
                });
            }
        }

        return filteredList;
    }

    // expecting round length of 2
    public static generateTeamComposition(rounds: RoundParser[]): TeamComposition<OutputPlayer> | undefined {
        // gather all team compositions
        let teamComps = rounds.map(round => round.playerList) as PlayerList[];

        // let's make the assumption that the team assignments should switch (blue -> red and vice versa)
        // arbitrary decision: make sure 50% of the players match
        const numRd1BluePlayers = ParserUtils.num(teamComps[0][1]);
        const numRd2BluePlayers = ParserUtils.num(teamComps[1][1]);
        const threshold = Math.floor(Math.max(numRd1BluePlayers, numRd2BluePlayers) / 2);
        if (Math.abs(numRd1BluePlayers - numRd2BluePlayers) > threshold) {
            return undefined;
        }

        // TODO: commented out because teams sub out the majority of their players; always assume that colors switch
        // // make sure at least 50% of players are represented on the "first" team (could also do this for other team, buttfuckit)
        // const rd1BluePlayers = teamComps[0][1];
        // const rd2RedPlayers = teamComps[1][2];

        // const numMatchingPlayers = rd1BluePlayers?.reduce<number>((numMatchingPlayers, player): number => {
        //     if (rd2RedPlayers?.some(redPlayer => redPlayer.matches(player)))
        //         numMatchingPlayers++;
        //     return numMatchingPlayers;
        // }, 0) || 0;

        // if ((numMatchingPlayers / numRd1BluePlayers) < 0.5) {
        //     return undefined;
        // }

        // map all players together
        let teamComp: TeamComposition<OutputPlayer> = {
            '1': teamComps[0][1]?.map(player => player.dumpOutput()),
            '2': teamComps[0][2]?.map(player => player.dumpOutput()),
        };

        // fill in missing players
        // rd2RedPlayers?.forEach(player => {
        teamComps[1][2]?.forEach(player => {
            // add missing players
            if (!teamComp[1]?.some(rd1Player => player.matches(rd1Player)))
                teamComp[1]?.push(player.dumpOutput());
        });

        teamComps[1][1]?.forEach(player => {
            // add missing players
            if (!teamComp[2]?.some(rd1Player => player.matches(rd1Player)))
                teamComp[2]?.push(player.dumpOutput());
        });

        return teamComp;
    }

    // assuming just teams 1 + 2
    public static setGameAwards(teamComp: TeamComposition<OutputPlayer>, stats: (OutputStats | undefined)[]): void {
        let mvpPoints: { [player_key: string]: number } = {};

        [1, 2].forEach(team => {
            if (teamComp[team]) {
                for (const player of teamComp[team])
                    mvpPoints[player.id] = 0;
            }
        });

        for (const roundStats of stats) {
            [1, 2].forEach(teamID => {
                if (!roundStats) return;

                const team: TeamOutputStatsDetailed = roundStats.teams[teamID];
                for (const player of team.players) {
                    let points = 0;
                    if (player.kills.kill)
                        points += 0.7 * player.kills.kill.value;
                    if (player.kills.sg)
                        points += 2.8 * player.kills.sg.value;
                    if (player.objectives?.flag_touch)
                        points += 1.4 * player.objectives.flag_touch.value;
                    if (player.objectives?.touches_initial)
                        points += 2.2 * player.objectives.touches_initial.value;
                    if (player.kills.teamkill)
                        points -= player.kills.teamkill.value;
                    if (player.objectives?.flag_capture_bonus)
                        points += 5 * player.objectives.flag_capture_bonus.value;

                    if (mvpPoints[player.id] != null)
                        mvpPoints[player.id] += points;
                }
            });
        }

        // who has the most points?
        let topPlayer: string = '';
        let topScore = 0;
        for (const player of Object.keys(mvpPoints)) {
            const playerPoints = mvpPoints[player];
            if (playerPoints > topScore) {
                topPlayer = player;
                topScore = playerPoints;
            }
        }

        for (const roundStats of stats) {
            [1, 2].forEach(teamID => {
                if (!roundStats) return;

                const team: TeamOutputStatsDetailed = roundStats.teams[teamID];
                for (const player of team.players) {
                    if (player.id === topPlayer) {
                        player.is_mvp = true;
                        break;
                    }
                }
            });
        }
    }

    public static playerListToOutput(teamComp: PlayerList): TeamComposition<OutputPlayer> {
        return {
            '1': teamComp[1] ? teamComp[1].map(player => player.dumpOutput()) : undefined,
            '2': teamComp[2] ? teamComp[2].map(player => player.dumpOutput()) : undefined,
        };
    }

    public static num<T>(arr: undefined | Array<T>): number {
        if (arr == null) return 0;
        return arr.length;
    }

    public static getScoreAndFlagMovements(events: Event[], teams?: PlayerList): [TeamScore, TeamFlagMovements] {
        const teamScoreEvents = events.filter(ev => ev.eventType === EventType.TeamScore);
        let scores: TeamScore = {};
        let flagMovements: TeamFlagMovements = {};

        let needToComputeTeamScore = true;
        teamScoreEvents.forEach(event => {
            const team = event.data && event.data.team;
            const score = event.data && event.data.value;
            if (!team) throw "expected team with a teamScore event";
            if (!score) throw "expected value with a teamScore event";
            scores[team] = Number(score);
            needToComputeTeamScore = false;
        });

        if (teams) {
            const flagCapEvents = events.filter(
                ev => ev.eventType === EventType.PlayerCapturedFlag
                || ev.eventType === EventType.PlayerCapturedBonusFlag
                || ev.eventType === EventType.TeamFlagHoldBonus);
            let pointsPerCap = 10;
            let pointsPerBonusCap = pointsPerCap;
            const pointsPerTeamFlagHoldBonus = 5; // Assume 5 points for flag hold bonus (ss_nyx_ectfc).
            if (!needToComputeTeamScore) {
                const firstTeamFlagCapEvents = events.filter(ev => {
                    return ev.eventType === EventType.PlayerCapturedFlag
                        && (ParserUtils.getTeamForPlayer(ev.playerFrom!, teams) == 1)
                });
                const firstTeamBonusFlagCapEvents = events.filter(ev => {
                    return ev.eventType === EventType.PlayerCapturedBonusFlag
                        && (ParserUtils.getTeamForPlayer(ev.playerFrom!, teams) == 1)
                });
                const firstTeamFlagHoldBonusEvents = flagCapEvents.filter(ev => ev.eventType === EventType.TeamFlagHoldBonus && ev.data!.team == TeamColor.Blue);
                const pointsFromFlagHoldBonuses = firstTeamFlagHoldBonusEvents.length * pointsPerTeamFlagHoldBonus;

                if (scores[1] && firstTeamBonusFlagCapEvents.length > 0) {
                    // This is a map with bonus caps, e.g. raiden6's coast-to-coast mechanic.
                    // To estimate the values for a normal cap and a bonus cap, assume a normal cap value of 10.
                    pointsPerCap = 10;
                    const estimatedBonusPointsTotal = scores[1] - (pointsPerCap * (firstTeamFlagCapEvents.length + firstTeamBonusFlagCapEvents.length));
                    pointsPerBonusCap = pointsPerCap + (estimatedBonusPointsTotal / firstTeamBonusFlagCapEvents.length);
                    console.log(`Estimate points for a bonus cap is ${pointsPerBonusCap}`);
                }
                else {
                    pointsPerCap = scores[1] ?
                        (firstTeamFlagCapEvents.length > 0 ?
                            ((scores[1] - pointsFromFlagHoldBonuses) / firstTeamFlagCapEvents.length) : pointsPerCap)
                        : pointsPerCap;
                }
                if (pointsPerCap != 10) {
                    console.warn(`Points per cap is ${pointsPerCap}`);
                }
            }

            if (needToComputeTeamScore) { // maybe the server crashed before finishing the log?
                console.warn("Can't find ending score, manually counting caps...");
            }
            let runningScore: TeamScore = {};
            flagCapEvents.forEach(event => {
                const player = event.playerFrom;

                let team : number;
                if (event.eventType == EventType.TeamFlagHoldBonus) {
                    team = event.data!.team!;
                }
                else {
                    team = ParserUtils.getTeamForPlayer(player!, teams);
                }

                if (!flagMovements[team]) {
                    const teamFlagStats: FlagMovement[] = [];
                    flagMovements[team] = teamFlagStats;
                    runningScore[team] = 0;
                }
                if (!runningScore[team]) {
                    runningScore[team] = 0;
                }
                switch (event.eventType) {
                    case EventType.TeamFlagHoldBonus:
                        runningScore[team] += pointsPerTeamFlagHoldBonus;
                        break;
                    case EventType.PlayerCapturedBonusFlag:
                        runningScore[team] += pointsPerBonusCap;
                        break;
                    default:
                        runningScore[team] += pointsPerCap;
                        break;
                }
                const flagMovement: FlagMovement = {
                    game_time_as_seconds: event.gameTimeAsSeconds!,
                    player: player ? player.name : "<Team>",
                    current_score: runningScore[team],
                    how_dropped: FlagDrop.Captured,

                }
                flagMovements[team].push(flagMovement);

                if (needToComputeTeamScore) { // only overwrite the team score if there was no teamScore event
                    scores[team] = runningScore[team];
                }
            });
        }

        return [scores, flagMovements];
    }

    public static generatePlayerStats(events: Event[]): PlayersStats {
        // sort the events
        let playerStats: PlayersStats = { flag: {} };
        for (const event of events) {
            if (!event.playerFrom) {
                // add flag events
                switch (event.eventType) {
                    case EventType.FlagReturn:
                        this.addStat(playerStats.flag, 'flag_return', event);
                        break;
                }
                continue; // skip all other non-player events
            }

            const thisPlayer = event.playerFrom;
            const thisPlayerStats = this.getPlayerFromStats(playerStats, thisPlayer);

            // this is a player-specific event (no other players involved)
            if (!event.playerTo) {
                switch (event.eventType) {
                    case EventType.PlayerBuiltDispenser:
                        this.addStat(thisPlayerStats, 'build_disp', event);
                        break;
                    case EventType.PlayerBuiltSentryGun:
                        this.addStat(thisPlayerStats, 'build_sg', event);
                        break;
                    case EventType.PlayerBuiltTeleporter:
                        this.addStat(thisPlayerStats, 'build_tele', event);
                        break;
                    case EventType.PlayerCapturedArenaCenter:
                    case EventType.PlayerCapturedArenaOpponent:
                    case EventType.PlayerCapturedArenaOwn:
                        // Special scrummage logic to get reasonable stats
                        // with minimal map-specific changes:
                        // Treat each arena capture generate a synthetic flag pickup event.
                        // For the team's own arena, treat it as one cap.
                        // For center arena, treat it as three caps.
                        // For the opposing team's arena, treat it as ten caps.
                        let syntheticCaptureCount = 1;
                        if (event.eventType == EventType.PlayerCapturedArenaCenter) {
                            syntheticCaptureCount = 3;
                        }
                        else if (event.eventType == EventType.PlayerCapturedArenaOpponent) {
                            syntheticCaptureCount = 10;
                        }
                        for (let i = 0; i < syntheticCaptureCount; i++) {
                            this.addStat(thisPlayerStats, 'flag_pickup', event);
                            this.addStat(playerStats.flag, 'flag_pickup', event);
                            this.addStat(thisPlayerStats, 'flag_capture', event);
                            this.addStat(playerStats.flag, 'flag_capture', event);
                        }
                        break;
                    case EventType.PlayerCapturedFlag:
                    case EventType.PlayerCapturedBonusFlag:
                    case EventType.PlayerCapturedPoint:
                        this.addStat(thisPlayerStats, 'flag_capture', event);
                        this.addStat(playerStats.flag, 'flag_capture', event);
                        break;
                    case EventType.PlayerChangeRole:
                        this.addStat(thisPlayerStats, 'role', event);
                        break;
                    case EventType.PlayerConced:
                        // This shouldn't be possible.
                        throw "Concussion grenade event didn't contain a second player";
                        this.addStat(thisPlayerStats, 'conc', event);
                        break;
                    case EventType.PlayerDetonatedBuilding:
                        // TODO: break out what kind of building?
                        this.addStat(thisPlayerStats, 'det_building', event);
                        break;
                    case EventType.PlayerDetpackExplode:
                        this.addStat(thisPlayerStats, 'detpack_explode', event);
                        break;
                    case EventType.PlayerDetpackSet:
                        this.addStat(thisPlayerStats, 'detpack_set', event);
                        break;
                    case EventType.PlayerDismantledBuilding:
                        this.addStat(thisPlayerStats, 'dismantle_building', event);
                        break;
                    case EventType.PlayerGotSecurity:
                        this.addStat(thisPlayerStats, 'got_button', event);
                        break;
                    case EventType.PlayerOpenedDetpackEntrance:
                        this.addStat(thisPlayerStats, 'det_entrance', event);
                        break;
                    case EventType.PlayerPickedUpFlag:
                        this.addStat(thisPlayerStats, 'flag_pickup', event);
                        this.addStat(playerStats.flag, 'flag_pickup', event);
                        break;
                    case EventType.PlayerPickedUpBonusFlag:
                        this.addStat(thisPlayerStats, 'flag_bonus_pickup', event);
                        break;
                    case EventType.PlayerThrewFlag:
                        this.addStat(thisPlayerStats, 'flag_throw', event);
                        this.addStat(playerStats.flag, 'flag_throw', event);
                        break;
                    case EventType.PlayerRepairedBuilding:
                        this.addStat(thisPlayerStats, 'repair_building', event);
                        break;
                    case EventType.PlayerUpgradedGun:
                        this.addStat(thisPlayerStats, 'upgrade_building', event);
                        break;
                    case EventType.PlayerMM1:
                    case EventType.PlayerMM2:
                        this.addStat(thisPlayerStats, 'chat', event);
                        break;
                    case EventType.PlayerSpawn:
                    case EventType.PlayerJoinServer:
                    case EventType.PlayerChangedName:
                    case EventType.PlayerLeftServer:
                        // no-op
                        break;
                    case EventType.SecurityUp:
                        // dunno what to do with this event
                        break;
                    case EventType.PlayerGainedFlagWithLocation:
                    case EventType.PlayerDroppedFlagViaDeathWithLocation:
                        // TODO: do something with these.
                        break;
                    default:
                        console.log(`didn't log event id ${EventType[event.eventType]} for ${thisPlayer.name}.`)
                }
            } else {
                // this involved another player... make sure both get an event
                const otherPlayer = event.playerTo;
                const otherPlayerStats = this.getPlayerFromStats(playerStats, otherPlayer);

                switch (event.eventType) {
                    case EventType.PlayerFraggedPlayer:
                        // ignore "timer" and other non-weapon kills; usually followed by an infection kill
                        if (event.withWeapon == Weapon.None)
                            break;

                        // figure out if this was a team-kill/-death
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_kill', event);
                            this.addStat(otherPlayerStats, 'team_death', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill', event);
                            this.addStat(otherPlayerStats, 'death', event);
                        }
                        break;
                    case EventType.PlayerCaltroppedPlayer:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_caltroper', event);
                            this.addStat(otherPlayerStats, 'team_caltroppee', event)
                        } else {
                            this.addStat(thisPlayerStats, 'caltropper', event);
                            this.addStat(otherPlayerStats, 'caltroppee', event);
                        }
                        break;
                    case EventType.PlayerConced:
                        if (thisPlayer == otherPlayer) {
                            this.addStat(thisPlayerStats, 'conc_jump', event);
                        } else if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'conc_team', event);
                            this.addStat(otherPlayerStats, 'team_concee', event)
                        } else {
                            this.addStat(thisPlayerStats, 'conc_enemy', event);
                            this.addStat(otherPlayerStats, 'concee', event);
                        }
                        break;
                    case EventType.PlayerDetpackDisarm:
                        // this is only possible between players on different teams
                        this.addStat(thisPlayerStats, 'detpack_disarmer', event);
                        this.addStat(otherPlayerStats, 'detpack_disarmee', event);
                        break;
                    case EventType.PlayerFraggedDispenser:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_kill_disp', event);
                            this.addStat(otherPlayerStats, 'team_die_disp', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill_disp', event);
                            this.addStat(otherPlayerStats, 'die_disp', event);
                        }
                        break;
                    case EventType.PlayerFraggedGun:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_kill_sg', event);
                            this.addStat(otherPlayerStats, 'team_die_sg', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill_sg', event);
                            this.addStat(otherPlayerStats, 'die_sg', event);
                        }
                        break;
                    case EventType.PlayerHallucinatedPlayer:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_piller', event);
                            this.addStat(otherPlayerStats, 'team_pillee', event);
                        } else {
                            this.addStat(thisPlayerStats, 'piller', event);
                            this.addStat(otherPlayerStats, 'pillee', event);
                        }
                        break;
                    case EventType.PlayerHeal:
                        // this is only fired between people on the same team
                        this.addStat(thisPlayerStats, 'healer', event);
                        this.addStat(otherPlayerStats, 'healee', event);
                        break;
                    case EventType.PlayerHitAirshot:
                        // this is only fired between people on different teams
                        this.addStat(thisPlayerStats, 'airshot', event);
                        this.addStat(otherPlayerStats, 'airshoted', event);
                        break;
                    case EventType.PlayerInfectedPlayer:
                        // this is only fired between people on different teams
                        this.addStat(thisPlayerStats, 'infecter', event);
                        this.addStat(otherPlayerStats, 'infectee', event);
                        break;
                    case EventType.PlayerPassedInfection:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_pass_infecter', event);
                            this.addStat(otherPlayerStats, 'team_pass_infectee', event);
                        } else {
                            this.addStat(thisPlayerStats, 'pass_infecter', event);
                            this.addStat(otherPlayerStats, 'pass_infectee', event);
                        }
                        break;
                    case EventType.PlayerTranqedPlayer:
                        if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_tranqer', event);
                            this.addStat(otherPlayerStats, 'team_tranqee', event);
                        } else {
                            this.addStat(thisPlayerStats, 'tranqer', event);
                            this.addStat(otherPlayerStats, 'tranqee', event);
                        }
                        break;
                    case EventType.PlayerUpgradedOtherGun:
                        // this can only happen between people on the same team
                        this.addStat(thisPlayerStats, 'team_building_repairer', event);
                        this.addStat(otherPlayerStats, 'team_building_repairee', event);
                        break;
                    case EventType.PlayerDamage:
                        // Damage event from custom server plugin that records damage throughout the log.
                        if (thisPlayer == otherPlayer) {
                            this.addStat(thisPlayerStats, 'self_damage', event);
                        }
                        else if (event.playerFrom.team === event.playerTo.team) {
                            this.addStat(thisPlayerStats, 'team_damager', event);
                            this.addStat(otherPlayerStats, 'team_damagee', event);
                        } else {
                            this.addStat(thisPlayerStats, 'damager', event);
                            this.addStat(otherPlayerStats, 'damagee', event);
                        }
                        break;
                    case EventType.PlayerCommitSuicide:
                        this.addStat(thisPlayerStats, 'suicide', event);
                        break;
                    case EventType.PlayerJoinTeam:
                        // no-op
                        break;
                    default:
                        console.warn(`didn't count event id ${EventType[event.eventType]} for ${thisPlayer.name} against ${otherPlayer.name}`);
                }
            }
        }

        return playerStats;
    }

    private static addStat(stats: Stats, key: string, event: Event) {
        if (!stats[key])
            stats[key] = [];

        stats[key].push(event);
    }

    private static getPlayerFromStats(playersStats: PlayersStats, player: Player): Stats {
        let thisPlayerStats = playersStats[player.steamID];
        if (!thisPlayerStats)
            thisPlayerStats = playersStats[player.steamID] = {};

        return thisPlayerStats;
    }

    private static getTeamForPlayer(player: Player, teams: PlayerList): number {
        for (const team in teams) {
            const foundPlayer = teams[team].findIndex(p => p === player);
            if (foundPlayer !== -1)
                return parseInt(team, 10);
        }

        return -1;
    }

    public static getPlayerFromTeams(steamId: string, teams: TeamsOutputStatsDetailed): PlayerOutputStatsRound | undefined {
        let foundPlayer: PlayerOutputStatsRound | undefined;
        for (const teamId in teams) {
            const team = teams[teamId] as TeamOutputStatsDetailed;
            foundPlayer = team.players.find(player => player.steamID === steamId);

            if (foundPlayer)
                break;
        }

        return foundPlayer;
    }

    public static generateOutputStats(roundState: RoundState, events: Event[], stats: PlayersStats, playerList: PlayerList, logfile: string): OutputStats {
        // map
        const mapEvent = events.find(event => event.eventType === EventType.MapLoading);
        const map = mapEvent && mapEvent.value || "(map not found)";

        // date
        const firstTimestamp = events[0].timestamp;
        const dayOfMonth = firstTimestamp.getDate();
        const month = Intl.DateTimeFormat('en-US', { month: 'short' }).format(firstTimestamp);
        const year = firstTimestamp.getFullYear();
        const date = [dayOfMonth, month, year].join(" ");

        // time
        const time = Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
            .format(firstTimestamp);

        // server
        const serverEvent = events.find(event => event.eventType === EventType.ServerName);
        const server = serverEvent && serverEvent.value || "Unknown server";

        // log name (server [up to 10 char or first word boundary], date string, time)
        let serverShortName = server.split(/\s+/)[0];
        // Remove reserved characters for Windows compat. The removal of slashes also eliminates the possibility of a path traversal attack.
        serverShortName = serverShortName.replace(/[\?\\/\*\"<>\|:]/g, "_");

        if (serverShortName.length > 10) serverShortName = serverShortName.slice(0, 10);
        const parse_name = [serverShortName, year, month, dayOfMonth, time.replace(":", "-")].join("-");

        // game time (should we calculate this somewhere else?)
        const matchStartEvent = events.find(event => event.eventType === EventType.PrematchEnd) || events[0];
        const matchEndEvent = events.find(event => event.eventType === EventType.TeamScore) || events[events.length - 1];

        const gameTime = Intl.DateTimeFormat('en-US', { minute: '2-digit', second: '2-digit' })
            .format(matchEndEvent.timestamp.valueOf() - matchStartEvent.timestamp.valueOf());

        const teams = this.generateOutputTeamsStatsDetailed(stats, playerList, matchEndEvent.timestamp);

        let damageStatsExist = false;
        for (const teamId in teams) {
            const team = teams[teamId] as TeamOutputStatsDetailed;
            if ((team.teamStats?.damage_enemy && team.teamStats?.damage_enemy > 0)
                || (team.teamStats?.damage_team && team.teamStats?.damage_team > 0)) {
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
                game_time_as_seconds: matchEndEvent.gameTimeAsSeconds ? matchEndEvent.gameTimeAsSeconds : 0
            },
            damage_stats_exist: damageStatsExist
        };
    }

    public static getTeamScores(events: Event[], playerList: PlayerList): TeamScore {
        const scoreEvents = events.filter(event => event.eventType === EventType.TeamScore);

        // only dump score events for non-spectator teams (1, 2; that's what below does...]
        let teamsScore: TeamScore = {};
        for (const scoreEvent of scoreEvents) {
            teamsScore[scoreEvent.key] = scoreEvent.value;
        }

        return teamsScore;
    }

    public static generateOutputTeamsStatsDetailed(
        stats: PlayersStats,
        players: PlayerList,
        matchEnd: Date): TeamsOutputStatsDetailed {

        // calculate stats per player
        let outputStats: TeamsOutputStatsDetailed = {};

        // iterate through the players identified as playing on the teams of interest (for now, Blue and Red)
        [1, 2].forEach(team => {
            const teamPlayerIDs = (players.teams[String(team)] as Player[])?.map(player => player.steamID) || [];
            const teamPlayers: PlayerOutputStatsRound[] = [];

            for (const playerID of teamPlayerIDs) {
                let poStats: PlayerOutputStatsRound = this.blankOutputPlayerStatsDetail(team);
                let thisPlayer = players.ensurePlayer(playerID, undefined, undefined, team) as Player;
                poStats.name = thisPlayer.name;
                poStats.steamID = playerID;
                poStats.id = thisPlayer.steamID.split(":")[2];

                const playerStats = stats[playerID];
                poStats.classes = this.calculateAndApplyPlayerClassOnAllEvents(thisPlayer, playerStats, matchEnd);
                for (const stat in playerStats) {
                    const statEvents = playerStats[stat];
                    switch (stat) {
                        /** classes */
                        case 'role':
                            poStats.roles = this.getPlayerClasses(statEvents, matchEnd); // TODO: Merge with applyPlayerRoleOnAllEvents
                            break;
                        /** kills */
                        case 'kill':
                            this.hydrateStat(poStats, thisPlayer, 'kills', 'kill', statEvents, "Enemy kills");
                            this.hydrateStat(poStats, thisPlayer, 'kills', 'kill_while_conced', statEvents.filter(ev => ev.whileConced == true), "Enemy kills while conced");
                            break;
                        case 'team_kill':
                            this.hydrateStat(poStats, thisPlayer, 'kills', 'teamkill', statEvents, "Team kills");
                            break;
                        case 'kill_sg':
                            this.hydrateStat(poStats, thisPlayer, 'kills', 'sg', statEvents, "Sentry gun kills");
                            break;
                        /** deaths */
                        case 'death':
                            this.hydrateStat(poStats, thisPlayer, 'deaths', 'death', statEvents, "Deaths by enemy");
                            break;
                        case 'team_death':
                            this.hydrateStat(poStats, thisPlayer, 'deaths', 'by_team', statEvents, "Deaths by teammates");
                            break;
                        case 'suicide':
                            this.hydrateStat(poStats, thisPlayer, 'deaths', 'by_self', statEvents, "Suicides");
                            break;
                        /** objectives */
                        case 'flag_pickup':
                            this.hydrateStat(poStats, thisPlayer, 'objectives', 'flag_touch', statEvents, "Flag touches");
                            break;
                        case 'flag_capture':
                            this.hydrateStat(poStats, thisPlayer, 'objectives', 'flag_capture', statEvents, "Flag captures");
                            break;
                        case 'got_button':
                            this.hydrateStat(poStats, thisPlayer, 'objectives', 'button', statEvents, "Got button / objective");
                            break;
                        case 'det_entrance':
                            this.hydrateStat(poStats, thisPlayer, 'objectives', 'det_entrance', statEvents, "Det entrace");
                            break;
                        /** weaponStats */
                        case 'conc_jump':
                            this.hydrateStat(poStats, thisPlayer, 'weaponStats', 'concs', statEvents, "Conc jumps");
                            break;
                        case 'airshot':
                            this.hydrateStat(poStats, thisPlayer, 'weaponStats', 'airshot', statEvents, "Airshot");
                            break;
                        case 'airshoted':
                            this.hydrateStat(poStats, thisPlayer, 'weaponStats', 'airshoted', statEvents, "Got airshot (airshitted)");
                            break;
                        // TODO: a bunch of others, save for later
                        /** buildables */
                        case 'build_disp':
                            this.hydrateStat(poStats, thisPlayer, 'buildables', 'build_disp', statEvents, "Built dispensers");
                            break;
                        case 'build_sg':
                            this.hydrateStat(poStats, thisPlayer, 'buildables', 'build_sg', statEvents, "Built sentry guns");
                            break;
                        /* damage stats */
                        case 'damager':
                            this.hydrateStat(poStats, thisPlayer, 'damage', 'to_enemies', statEvents, "Damage dealt to enemies");
                            break;
                        case 'damagee':
                            this.hydrateStat(poStats, thisPlayer, 'damage', 'from_enemies', statEvents, "Damage taken from enemies");
                            break;
                        case 'team_damager':
                            this.hydrateStat(poStats, thisPlayer, 'damage', 'to_team', statEvents, "Damage dealt to teammates");
                            break;
                        case 'team_damagee':
                            this.hydrateStat(poStats, thisPlayer, 'damage', 'from_team', statEvents, "Damage taken from teammates");
                            break;
                        case 'self_damage':
                            this.hydrateStat(poStats, thisPlayer, 'damage', 'to_self', statEvents, "Damage dealt to self");
                            break;
                        // TODO: a bunch of others, save for later
                    }
                }

                // Flag statistics (requires holistic view of flag movement).
                const [flag_time_in_seconds, toss_percent, touches_initial] =  [
                        thisPlayer.roundStats.flagCarryTimeInSeconds,
                        thisPlayer.roundStats.flagCarries > 0 ? Math.round(thisPlayer.roundStats.flagThrows / thisPlayer.roundStats.flagCarries * 100) : 0,
                        thisPlayer.roundStats.flagInitialTouches];

                this.ensureStat(poStats, 'objectives', 'flag_time_in_seconds').value = flag_time_in_seconds;
                this.ensureStat(poStats, 'objectives', 'toss_percent').value = toss_percent;
                this.ensureStat(poStats, 'objectives', 'touches_initial').value = touches_initial;

                if (playerStats['flag_capture']) {
                    // calculatePlayerFlagStats (called above) updates PlayerCapturedFlag to PlayerCapturedBonusFlag if it involved a cap with a bonus.
                    const capsWithBonus = playerStats['flag_capture'].filter(ev => ev.eventType == EventType.PlayerCapturedBonusFlag);
                    this.hydrateStat(poStats, thisPlayer, 'objectives', 'flag_capture_bonus', capsWithBonus, "Flag captures with bonus");
                }

                teamPlayers.push(poStats);
            }

            // do the stupid thing and order players by number of frags
            teamPlayers.sort((a, b) => a.team === b.team ? (b.kills?.kill?.events?.length ?? 0) - (a.kills?.kill?.events?.length ?? 0) : 0);

            // dump stats for this team
            outputStats[team] = {
                players: teamPlayers,
                teamStats: this.generateOutputTeamStatsDetail(teamPlayers, team),
            };
        });

        return outputStats;
    }

    private static generateOutputTeamStatsDetail(teamPlayers: PlayerOutputStatsRound[], team: number) {
        // TODO: do some logic based on the plurarity of medics on a team?
        // for now, assume team 1 (blue) is always offense
        const teamRole: TeamRole = team === 1 ? TeamRole.Offense : team === 2 ? TeamRole.Defense : TeamRole.Unknown;

        let stats =  teamPlayers.reduce((stats, player) => {
            stats.frags += this.getSummarizedStat(player, 'kills', 'kill')
                - this.getSummarizedStat(player, 'kills', 'teamkill')
                + this.getSummarizedStat(player, 'kills', 'sg');

            stats.kills += this.getSummarizedStat(player, 'kills', 'kill');
            stats.team_kills += this.getSummarizedStat(player, 'kills', 'teamkill');
            stats.conc_kills += this.getSummarizedStat(player, 'kills', 'kill_while_conced');

            stats.deaths += this.getSummarizedStat(player, 'deaths', 'death')
                + this.getSummarizedStat(player, 'deaths', 'by_team')
                + this.getSummarizedStat(player, 'deaths', 'by_self');

            stats.d_enemy += this.getSummarizedStat(player, 'deaths', 'death');
            stats.d_self += this.getSummarizedStat(player, 'deaths', 'by_self');
            stats.d_team += this.getSummarizedStat(player, 'deaths', 'by_team');
            stats.damage_enemy += this.getSummarizedStat(player, 'damage', 'to_enemies');
            stats.damage_team += this.getSummarizedStat(player, 'damage', 'to_team');

            switch (stats.teamRole) {
                case TeamRole.Offense:
                    stats.sg_kills += this.getSummarizedStat(player, 'kills', 'sg');
                    stats.concs += this.getSummarizedStat(player, 'weaponStats', 'concs');
                    stats.caps += this.getSummarizedStat(player, 'objectives', 'flag_capture');
                    stats.caps_bonus += this.getSummarizedStat(player, 'objectives', 'flag_capture_bonus');
                    stats.touches += this.getSummarizedStat(player, 'objectives', 'flag_touch');
                    stats.touches_initial += this.getSummarizedStat(player, 'objectives', 'touches_initial');

                    stats.toss_percent += this.getSummarizedStat(player, 'objectives', 'toss_percent')
                        * this.getSummarizedStat(player, 'objectives', 'flag_touch');

                    stats.flag_time_in_seconds += this.getSummarizedStat(player, 'objectives', 'flag_time_in_seconds');

                    break;
                case TeamRole.Defense:
                    stats.airshots += this.getSummarizedStat(player, 'weaponStats', 'airshot');
                    break;
            }

            return stats;
        }, this.blankTeamStats(teamRole));

        // do some clean-up (average instead of sum for toss)
        if (stats.teamRole === TeamRole.Offense) {
            stats.toss_percent = Math.round(stats.toss_percent / stats.touches);
        }

        return stats;
    }

    private static blankOutputPlayerStatsDetail(team: number = 5): PlayerOutputStatsRound {
        return {
            name: "(unknown)",
            roles: "(unknown)",
            team: team,
            steamID: "(unknown)",
            id: "unk",
            classes: [],
            deaths: {},
            kills: {},
            round_number: 0,
        };
    }

    private static ensureStat<T = number>(
        playerStats: NonNullable<PlayerOutputStatsRound>,
        category: string,
        item: string,
        description?: string): GenericStat<any, T> {

        if (!playerStats[category]) {
            playerStats[category] = {};
        }

        if (!playerStats[category][item]) {
            playerStats[category][item] = {
                title: item,
                value: undefined,
                description,
                events: [],
            };
        }

        return playerStats[category][item];
    }

    private static hydrateStat(
        playerStats: PlayerOutputStatsRound,
        player: Player,
        category: string,
        item: string,
        events: Event[],
        description?: string): GenericStat {

        const thisStat = this.ensureStat(playerStats, category, item, description);
        thisStat.events = events;
        if (category !== "damage") {
            thisStat.value = events.length;

            const facetedStat = this.generateStatDetails(player, category, thisStat);
            if (facetedStat != null) {
                thisStat.weapon_summary = facetedStat.weapon_summary;
                thisStat.details = facetedStat.details;
            }
        }
        else { // For stats that require summing numbers from the events, e.g. damage done.
            thisStat.value = 0;
            events.forEach((event) => {
                thisStat.value += Number(event.data?.value);
            });

            const damageStats = this.generateDamageStats(player, thisStat);
            if (damageStats != null) {
                thisStat.details = damageStats.details;
            }
        }

        return thisStat;
    }

    private static generateDamageStats(player: Player, stat: GenericStat): FacetedStat | undefined {
        const events = stat.events;
        if (events == null)
            return;

        const facetedDetails : FacetedStatDetails = {};
        let perPlayerDamage = new Map<Player, number>();
        for (const e of events) {
            const otherPlayer : Player = (player === e.playerTo) ? e.playerFrom! : e.playerTo!;
            // Aggregate stats per-player.
            if (!perPlayerDamage.has(otherPlayer)) {
                perPlayerDamage.set(otherPlayer, 0);
            }
            perPlayerDamage.set(otherPlayer, perPlayerDamage.get(otherPlayer)! + Number(e.data?.value));
        }

        for (let playerDamage of perPlayerDamage) {
            const otherPlayer = playerDamage[0].name;
            if (!facetedDetails[otherPlayer])
                facetedDetails[otherPlayer] = [];

            facetedDetails[otherPlayer].push({ value: playerDamage[1].toString(), whileConced: false, description: "", cssClassToAdd: "" });
        }

        return { details: facetedDetails };
    }

    private static generateStatDetails(player: Player, category: string, stat: GenericStat): FacetedStat | undefined {
        const events = stat.events;
        if (events == null)
            return;

        switch (category) {
            case 'kills':
                switch (stat.title) {
                    case 'kill':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${this.getTime(e)}`,
                            true);
                    case 'kill_while_conced':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} while conced at ${this.getTime(e)}`,
                            true);
                    case 'teamkill':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Team killed ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${this.getTime(e)}`,
                            true);
                    case 'sg':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerTo?.name}'s sentry gun at ${this.getTime(e)}`,
                            true);
                    default:
                        throw "generateStatDetails: not implemented";
                }
            case 'deaths':
                switch (stat.title) {
                    case 'death':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${this.getTime(e)}`);
                    case 'by_team':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Team-killed ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${this.getTime(e)}`);
                    case 'by_self':
                        return this.generateFacetedStats(stat.events!,
                            (e) => {
                                const weaponString: string = e.withWeapon ? `with ${DisplayStringHelper.weaponToDisplayString(e.withWeapon)} ` : "";
                                return `Suicided ${weaponString}${e.playerToWasCarryingFlag ? "while carrying flag " : ""}at ${this.getTime(e)}`;
                            });
                }
                break;
            case 'weaponStats':
                switch (stat.title) {
                    case 'airshot':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Airshot ${e.playerToWasCarryingFlag ? "flag carrier " : ""}${e.playerTo?.name} at ${this.getTime(e)} (${e.data?.value} meters)`,
                            true);
                    case 'airshoted':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Airshoted ${e.playerToWasCarryingFlag ? "while carrying flag " : ""}by ${e.playerFrom?.name} at ${this.getTime(e)} (${e.data?.value} meters)`);
                    default:
                        console.log(`generateStatDetails: not implemented: weaponStats > ${stat.title}`);
                }
                break;
            case 'damage':
                // Ignore; handled in generateDamageStats.
                break;
            default:
                console.log(`generateStatDetails: not implemented: ${category} > ${stat.title}`)
        }
    }

    private static generateFacetedStats(events: Event[], descriptor: EventDescriptor, isByPlayer?: boolean): FacetedStat {
        const facetedDetails = {};
        const facetedWeaponCounts: { [key in Weapon]?: number } = {};
        const allDetails = events.map(e => (<StatDetails>{
            description: descriptor(e),
            cssClassToAdd: (e.playerFrom?.team != e.playerTo?.team && e.playerToWasCarryingFlag) ? "weapon-highlight-good" : e.playerToWasCarryingFlag ? "weapon-highlight-bad" : "",
            player: isByPlayer ? e.playerTo : e.playerFrom,
            weapon: e.withWeapon
        }));

        for (const detail of allDetails) {
            // per-player
            const otherPlayer = detail.player?.name || "default";
            if (!facetedDetails[otherPlayer])
                facetedDetails[otherPlayer] = [];

            facetedDetails[otherPlayer].push(detail);

            // per-weapon
            const weapon = detail.weapon || 0;
            if (!facetedWeaponCounts[weapon])
                facetedWeaponCounts[weapon] = 0;

            facetedWeaponCounts[weapon]!++;
        }

        // finalize per-weapon stats
        const facetedWeapon: FacetedStatSummary = {};
        for (const weapon_stat in facetedWeaponCounts) {
            const weapon_count = facetedWeaponCounts[weapon_stat];
            facetedWeapon[weapon_stat] = `${weapon_count} (${Math.round(weapon_count / events.length * 100)}%)`;
        }

        return { details: facetedDetails, weapon_summary: facetedWeapon };
    }

    private static getTime(e: Event): string {
        return Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(e.gameTimeAsSeconds! * 1000);
    }

    private static getSummarizedStat(playerStats: PlayerOutputStatsRound, category: string, item: string): number {
        const statCategory = playerStats[category];
        if (statCategory)
            return statCategory?.[item]?.value ?? 0

        return 0;
    }

    private static blankTeamStats(teamRole: TeamRole = TeamRole.Unknown): TeamStats {
        let blankStats: TeamStats = {
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
            damage_team: 0
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

    public static generateTeamRoleComparison(stats: [OutputStats, OutputStats]): TeamStatsComparison {
        // expect that stats is of length 2 (two rounds)
        const offenseTeams = stats.map(roundStats => roundStats.teams[1]!.teamStats) as [OffenseTeamStats, OffenseTeamStats];
        const defenseTeams = stats.map(roundStats => roundStats.teams[2]!.teamStats) as [DefenseTeamStats, DefenseTeamStats];

        const offenseDiff: OffenseTeamStats = {
            team: 0,
            teamRole: TeamRole.Offense,
            frags: offenseTeams[0].frags - offenseTeams[1].frags,
            kills: offenseTeams[0].kills - offenseTeams[1].kills,
            sg_kills: offenseTeams[0].sg_kills - offenseTeams[1].sg_kills,
            team_kills: offenseTeams[0].team_kills - offenseTeams[1].team_kills,
            conc_kills: offenseTeams[0].conc_kills - offenseTeams[1].conc_kills,
            deaths: offenseTeams[0].deaths - offenseTeams[1].deaths,
            d_enemy: offenseTeams[0].d_enemy - offenseTeams[1].d_enemy,
            d_self: offenseTeams[0].d_self - offenseTeams[1].d_self,
            d_team: offenseTeams[0].d_team - offenseTeams[1].d_team,
            damage_enemy: offenseTeams[0].damage_enemy - offenseTeams[1].damage_enemy,
            damage_team: offenseTeams[0].damage_team - offenseTeams[1].damage_team,
            concs: offenseTeams[0].concs - offenseTeams[1].concs,
            caps: offenseTeams[0].caps - offenseTeams[1].caps,
            caps_bonus: offenseTeams[0].caps_bonus - offenseTeams[1].caps_bonus,
            touches: offenseTeams[0].touches - offenseTeams[1].touches,
            touches_initial: offenseTeams[0].touches_initial - offenseTeams[1].touches_initial,
            toss_percent: offenseTeams[0].toss_percent - offenseTeams[1].toss_percent,
            flag_time_in_seconds: offenseTeams[0].flag_time_in_seconds - offenseTeams[1].flag_time_in_seconds,
        };

        const defenseDiff: DefenseTeamStats = {
            team: 0,
            teamRole: TeamRole.Defense,
            frags: defenseTeams[1].frags - defenseTeams[0].frags,
            kills: defenseTeams[1].kills - defenseTeams[0].kills,
            team_kills: defenseTeams[1].team_kills - defenseTeams[0].team_kills,
            conc_kills: defenseTeams[1].conc_kills - defenseTeams[0].conc_kills,
            deaths: defenseTeams[1].deaths - defenseTeams[0].deaths,
            d_enemy: defenseTeams[1].d_enemy - defenseTeams[0].d_enemy,
            d_self: defenseTeams[1].d_self - defenseTeams[0].d_self,
            d_team: defenseTeams[1].d_team - defenseTeams[0].d_team,
            damage_enemy: defenseTeams[1].damage_enemy - defenseTeams[0].damage_enemy,
            damage_team: defenseTeams[1].damage_team - defenseTeams[0].damage_team,
            airshots: defenseTeams[1].airshots - defenseTeams[0].airshots,
        };

        return [offenseDiff, defenseDiff];
    }

    private static calculateAndApplyPlayerClassOnAllEvents(player: Player, playerEvents: Stats, matchEnd: Date) {
        let classTimes: ClassTime[] = [];

        let roleChangedEvents = playerEvents['role'];
        if (!roleChangedEvents) {
            return classTimes;
        }
        roleChangedEvents.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

        let lastChangeEvent: Event | undefined;
        let lastClass: PlayerClass | undefined;
        for (const roleChangedEvent of roleChangedEvents) {
            // skip the initial role if no timestamp set
            if (lastChangeEvent !== undefined && lastClass !== undefined) {
                // calculate the time for the last class and add entry
                const time = Intl.DateTimeFormat('en-US', { minute: '2-digit', second: '2-digit' })
                    .format(roleChangedEvent.timestamp.valueOf() - lastChangeEvent.timestamp.valueOf());

                classTimes.push({
                    class: lastClass,
                    classAsString: DisplayStringHelper.classToDisplayString(lastClass),
                    time,
                    startLineNumber: lastChangeEvent.lineNumber,
                    endLineNumber: (roleChangedEvent.lineNumber - 1)
                });
            }

            lastClass = roleChangedEvent.data!.class;
            lastChangeEvent = roleChangedEvent;
        }

        // make sure to record the last class picked
        if (lastClass && lastChangeEvent) {
            // calculate the time for the last class and add entry
            const time = Intl.DateTimeFormat('en-US', { minute: '2-digit', second: '2-digit' })
                .format(matchEnd.valueOf() - lastChangeEvent.timestamp.valueOf());

            classTimes.push({
                class: lastClass,
                classAsString: DisplayStringHelper.classToDisplayString(lastClass),
                time,
                startLineNumber: lastChangeEvent.lineNumber,
                endLineNumber: null
            });
        }

        // apply the class on all of the player's events
        for (const stat in playerEvents) {
            let statEvents = playerEvents[stat];
            statEvents.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

            let curClassIndex = 0;
            statEvents.forEach((statEvent) => {
                // Advance through the array of class choices until we reach the one that started prior to this event.
                while (curClassIndex < classTimes.length
                    && classTimes[curClassIndex].endLineNumber != null
                    && statEvent.lineNumber > classTimes[curClassIndex].endLineNumber!) {
                    curClassIndex++;
                }
                if (curClassIndex < classTimes.length) {
                    if (player == statEvent.playerFrom) {
                        statEvent.playerFromClass = classTimes[curClassIndex].class;
                    }
                    if (player == statEvent.playerTo) {
                        statEvent.playerToClass = classTimes[curClassIndex].class;
                    }
                }
            });
        }

        return classTimes;
    }

    private static getPlayerClasses(roleChangedEvents: Event[], matchEnd: Date): string {
        // collect times of classes; rank by most-played to least
        roleChangedEvents.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);
        let classTimes: Partial<{ [key in PlayerClass]: number}> = {};

        let lastClass: PlayerClass | undefined;
        const lastTimestamp = roleChangedEvents.reduce<Date | undefined>((lastTimestamp, roleChangedEvent) => {
            lastClass = roleChangedEvent.data!.class;

            // skip the initial role (no previous timestamp set)
            if (lastTimestamp !== undefined && lastClass !== undefined) {
                // calculate time for the last class
                classTimes[lastClass] = classTimes[lastClass] || 0;
                classTimes[lastClass]! += roleChangedEvent.timestamp.valueOf() - lastTimestamp.valueOf();
            }

            return roleChangedEvent.timestamp;
        }, undefined);

        // record last class
        if (lastClass && lastTimestamp) {
            classTimes[lastClass] = classTimes[lastClass] || 0;
            classTimes[lastClass]! += matchEnd.valueOf() - lastTimestamp.valueOf();
        } else
            throw "player never picked a class";

        // generate ranked class list
        let rankedList: { role: PlayerClass, time: number }[] = [];
        for (const classId in classTimes) {
            // are you serious
            const role = classId as unknown as PlayerClass;

            const classStats = { role, time: classTimes[role] || 0 };
            rankedList.push(classStats);
        }
        rankedList.sort((a, b) => a.time - b.time);

        // print classes
        return rankedList.map(role => PlayerClass[role.role]).join(', ');
    }
}
