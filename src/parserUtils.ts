import PlayerList from "./playerList";
import { Event, RoundParser } from "./parser";
import Player from "./player";
import { TeamColor, OutputStats, PlayerClass, TeamStatsComparison, TeamRole, TeamStats, OffenseTeamStats, DefenseTeamStats, OutputPlayer, PlayerOutputStatsRound, TeamsOutputStatsDetailed, GenericStat, ClassTime, TeamOutputStatsDetailed, StatDetails, FacetedStat, EventDescriptor, Weapon, FacetedStatSummary } from "./constants";
import EventType from "./eventType";

export type TeamComposition<TPlayer = Player> = { [team in TeamColor]?: TPlayer[]; };
export type TeamScore = { [team in TeamColor]?: number; };
export type PlayersStats = { [playerID: string]: Stats } & { 'flag': Stats };
export type Stats = { [stat: string]: Event[] };

export default class ParserUtils {
    public static getPlayerTeams(events: Event[], playerList: PlayerList): TeamComposition {
        let teams: TeamComposition = {};
        const teamChangeEvents = events.filter(ev => ev.eventType === EventType.PlayerJoinTeam);

        const playerTeams: { [playerID: string]: { lineNumber: number, timestamp: number, team: TeamColor }[] } = {};
        teamChangeEvents.forEach(event => {
            // find the player in the team list; add if it isn't there
            const player = event.playerFrom as Player;
            let playerRecord = playerTeams[player.steamID]
            if (!playerRecord)
                playerRecord = playerTeams[player.steamID] = [];

            const team = event.data && event.data.team;
            if (!team) throw "expected team with a 'joined team' event";

            playerRecord.push({ lineNumber: event.lineNumber, timestamp: event.timestamp.getTime(), team: team });
        });

        // get the end of the round as a reference
        const endTime = events[events.length - 1].timestamp.getTime();

        // calculate the longest time a player has been on the team, keep them there
        // first appeared team is when they first joined a team, so use that as the start time
        for (const player in playerTeams) {
            const playerTimes = playerTeams[player];

            let maxTime = 0;
            let primaryTeam: TeamColor = TeamColor.Spectator;

            const isLast = (i) => i >= playerTimes.length - 1;
            playerTimes.forEach((event, i) => {
                let thisTime = isLast(i) ? endTime - event.timestamp : playerTimes[i + 1].timestamp - event.timestamp;
                if (thisTime > maxTime) {
                    primaryTeam = event.team;
                    maxTime = thisTime;
                }
            });

            // add player to that winning team
            if (!teams[primaryTeam])
                teams[primaryTeam] = [];

            const playerObj = playerList.getPlayer(player);
            if (playerObj)
                teams[primaryTeam]!.push(playerObj);
        }

        return teams;
    }

    // expecting round length of 2
    public static generateTeamComposition(rounds: RoundParser[]): TeamComposition<OutputPlayer> | undefined {
        // gather all team compositions
        let teamComps = rounds.map(round => round.teams) as TeamComposition[];

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

    public static teamCompToOutput(teamComp: TeamComposition): TeamComposition<OutputPlayer> {
        return {
            '1': teamComp[1]?.map(player => player.dumpOutput()),
            '2': teamComp[2]?.map(player => player.dumpOutput()),
        };
    }

    public static num<T>(arr: undefined | Array<T>): number {
        if (arr == null) return 0;
        return arr.length;
    }

    public static getScore(events: Event[], teams?: TeamComposition): TeamScore {
        const teamScoreEvents = events.filter(ev => ev.eventType === EventType.TeamScore);
        let scores: TeamScore = {};

        teamScoreEvents.forEach(event => {
            const team = event.data && event.data.team;
            const score = event.data && event.data.value;
            if (!team) throw "expected team with a teamScore event";
            if (!score) throw "expected value with a teamScore event";
            scores[team] = Number(score);
        });

        // maybe the server crashed before finishing the log?  fallback to counting caps
        if (Object.keys(scores).length === 0 && teams) {
            console.warn("Can't find ending score, manually counting caps...");

            const flagCapEvents = events.filter(ev => ev.eventType === EventType.PlayerCapturedFlag);
            flagCapEvents.forEach(event => {
                const player = event.playerFrom!;
                const team = ParserUtils.getTeamForPlayer(player, teams);

                let teamScore = scores[team] || 0;
                scores[team] = teamScore + 10;
            });
        }

        return scores;
    }

    public static getPlayerStats(events: Event[], teams: TeamComposition): PlayersStats {
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
                    case EventType.PlayerCapturedFlag:
                        this.addStat(thisPlayerStats, 'flag_capture', event);
                        this.addStat(playerStats.flag, 'flag_capture', event);
                        break;
                    case EventType.PlayerChangeRole:
                        this.addStat(thisPlayerStats, 'role', event);
                        break;
                    case EventType.PlayerCommitSuicide:
                        this.addStat(thisPlayerStats, 'suicide', event);
                        break;
                    case EventType.PlayerConced:
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
                    case EventType.PlayerJoinTeam:
                        // no-op
                        break;
                    case EventType.SecurityUp:
                        // dunno what to do with this event
                        break;
                    default:
                        console.log(`didn't log event id ${event.eventType} for ${thisPlayer.name}.`)
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
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
                            this.addStat(thisPlayerStats, 'team_kill', event);
                            this.addStat(otherPlayerStats, 'team_death', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill', event);
                            this.addStat(otherPlayerStats, 'death', event);
                        }
                        break;
                    case EventType.PlayerCaltroppedPlayer:
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
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
                        } else if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
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
                    case EventType.PlayerFraggedDispenser:
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
                            this.addStat(thisPlayerStats, 'team_kill_disp', event);
                            this.addStat(otherPlayerStats, 'team_die_disp', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill_disp', event);
                            this.addStat(otherPlayerStats, 'die_disp', event);
                        }
                        break;
                    case EventType.PlayerFraggedGun:
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
                            this.addStat(thisPlayerStats, 'team_kill_sg', event);
                            this.addStat(otherPlayerStats, 'team_die_sg', event);
                        } else {
                            this.addStat(thisPlayerStats, 'kill_sg', event);
                            this.addStat(otherPlayerStats, 'die_sg', event);
                        }
                        break;
                    case EventType.PlayerHallucinatedPlayer:
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
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
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
                            this.addStat(thisPlayerStats, 'team_pass_infecter', event);
                            this.addStat(otherPlayerStats, 'team_pass_infectee', event);
                        } else {
                            this.addStat(thisPlayerStats, 'pass_infecter', event);
                            this.addStat(otherPlayerStats, 'pass_infectee', event);
                        }
                        break;
                    case EventType.PlayerTranqedPlayer:
                        if (this.playersOnSameTeam(teams, thisPlayer, otherPlayer)) {
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
                    default:
                        console.warn(`didn't count event id ${event.eventType} for ${thisPlayer.name} against ${otherPlayer.name}`);
                }
            }
        }

        return playerStats;
    }

    // expects time of format 00:00 (min:sec)
    private static addTime(timeA: string, timeB: string): string {
        const timeAParts = timeA.split(":");
        const timeBParts = timeB.split(":");
        const seconds = parseInt(timeAParts[1]) + parseInt(timeBParts[1]);
        const minutes = parseInt(timeAParts[0]) + parseInt(timeBParts[0]) + Math.floor(seconds / 60);

        const minPad = minutes < 10 ? "0" : "";
        const dispSeconds = seconds % 60;
        const secPad = dispSeconds < 10 ? "0" : "";

        return `${minPad + minutes}:${secPad + dispSeconds}`;
    }

    // expects time of format 00:00 (min:sec)
    private static diffTime(timeA: string, timeB: string): string {
        const timeAParts = timeA.split(":");
        const timeBParts = timeB.split(":");
        const seconds = parseInt(timeAParts[1]) - parseInt(timeBParts[1]);
        const minCarryover = seconds >= 0 ? Math.floor(seconds / 60) : Math.ceil(seconds / 60);
        const minutes = parseInt(timeAParts[0]) - parseInt(timeBParts[0]) + minCarryover;

        const minPad = minutes < 10 && minutes >= 0 ? "0" : "";
        const dispSeconds = Math.abs(seconds % 60);
        const secPad = dispSeconds < 10 ? "0" : "";

        return `${minPad + minutes}:${secPad + dispSeconds}`;
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

    private static playersOnSameTeam(teams: TeamComposition, player1: Player, player2: Player): boolean {
        return Object.keys(teams).some((team) => {
            const teamPlayers = teams[team] as Player[];
            if (teamPlayers && teamPlayers.indexOf(player1) !== -1 && teamPlayers.indexOf(player2) !== -1)
                return true;
            return false;
        });
    }

    private static getTeamForPlayer(player: Player, teams: TeamComposition): number {
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

    public static generateOutputStats(events: Event[], stats: PlayersStats, playerList: PlayerList, teamComp: TeamComposition, logfile: string): OutputStats {
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
        if (serverShortName.length > 10) serverShortName = serverShortName.slice(0, 10);
        const parse_name = [serverShortName, year, month, dayOfMonth, time.replace(":", "-")].join("-");

        // game time (should we calculate this somewhere else?)
        const prematchEndEvent = events.find(event => event.eventType === EventType.PrematchEnd);
        const matchEndEvent = events.find(event => event.eventType === EventType.TeamScore);

        const matchStart = prematchEndEvent && prematchEndEvent.timestamp || firstTimestamp;
        const matchEnd = matchEndEvent && matchEndEvent.timestamp || events[events.length - 1].timestamp;
        const gameTime = Intl.DateTimeFormat('en-US', { minute: '2-digit', second: '2-digit' })
            .format(matchEnd.valueOf() - matchStart.valueOf());

        const teams = this.generateOutputTeamsStatsDetailed(stats, playerList, teamComp, matchEnd);
        const score = this.getScore(events, teamComp);

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
            score,
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
        teams: TeamComposition,
        matchEnd: Date): TeamsOutputStatsDetailed {

        // calculate stats per player
        let outputStats: TeamsOutputStatsDetailed = {};

        // iterate through the players identified as playing on the teams of interest (for now, Blue and Red)
        [1, 2].forEach(team => {
            const teamPlayerIDs = (teams[String(team)] as Player[]).map(player => player.steamID);
            const teamPlayers: PlayerOutputStatsRound[] = [];

            for (const playerID of teamPlayerIDs) {
                let poStats: PlayerOutputStatsRound = this.blankOutputPlayerStatsDetail(team);
                let thisPlayer = players.getPlayer(playerID) as Player;
                poStats.name = thisPlayer.name;
                poStats.steamID = playerID;
                poStats.id = thisPlayer.steamID.split(":")[2];

                const playerStats = stats[playerID];
                poStats.classes = this.calculateAndApplyPlayerClassOnAllEvents(thisPlayer, playerStats, matchEnd);
                this.calculateAndApplyWhileConcedOnAllEvents(thisPlayer, playerStats);
                for (const stat in playerStats) {
                    const statEvents = playerStats[stat];
                    switch (stat) {
                        /** classes */
                        case 'role':
                            poStats.roles = this.getPlayerClasses(statEvents, matchEnd); // TODO: Merge with applyPlayerRoleOnAllEvents
                            break;
                        /** kills */
                        case 'kill':
                            this.hydrateStat(poStats, 'kills', 'kill', statEvents, "Enemy kills");
                            this.hydrateStat(poStats, 'kills', 'kill_while_conced', statEvents.filter(ev => ev.whileConced == true), "Enemy kills while conced");
                            break;
                        case 'team_kill':
                            this.hydrateStat(poStats, 'kills', 'teamkill', statEvents, "Team kills");
                            break;
                        case 'kill_sg':
                            this.hydrateStat(poStats, 'kills', 'sg', statEvents, "Sentry gun kills");
                            break;
                        /** deaths */
                        case 'death':
                            this.hydrateStat(poStats, 'deaths', 'death', statEvents, "Deaths by enemy");
                            break;
                        case 'team_death':
                            this.hydrateStat(poStats, 'deaths', 'by_team', statEvents, "Deaths by teammates");
                            break;
                        case 'suicide':
                            this.hydrateStat(poStats, 'deaths', 'by_self', statEvents, "Suicides");
                            break;
                        /** objectives */
                        case 'flag_pickup':
                            this.hydrateStat(poStats, 'objectives', 'flag_touch', statEvents, "Flag touches");
                            break;
                        case 'flag_capture':
                            this.hydrateStat(poStats, 'objectives', 'flag_capture', statEvents, "Flag captures");
                            break;
                        case 'got_button':
                            this.hydrateStat(poStats, 'objectives', 'button', statEvents, "Got button / objective");
                            break;
                        case 'det_entrance':
                            this.hydrateStat(poStats, 'objectives', 'det_entrance', statEvents, "Det entrace");
                            break;
                        /** weaponStats */
                        case 'conc_jump':
                            this.hydrateStat(poStats, 'weaponStats', 'concs', statEvents, "Conc jumps");
                            break;
                        case 'airshot':
                            this.hydrateStat(poStats, 'weaponStats', 'airshot', statEvents, "Airshot");
                            break;
                        case 'airshoted':
                            this.hydrateStat(poStats, 'weaponStats', 'airshoted', statEvents, "Got airshot (airshitted)");
                            break;
                        // TODO: a bunch of others, save for later
                        /** buildables */
                        case 'build_disp':
                            this.hydrateStat(poStats, 'buildables', 'build_disp', statEvents, "Built dispensers");
                            break;
                        case 'build_sg':
                            this.hydrateStat(poStats, 'buildables', 'build_sg', statEvents, "Built sentry guns");
                            break;
                        // TODO: a bunch of others, save for later
                    }
                }

                // flag statistics (requires holistic view of flag movement)
                const [flag_time, toss_percent, touches_initial] = this.calculatePlayerFlagStats(thisPlayer, playerStats, stats.flag, matchEnd);
                this.ensureStat<string>(poStats, 'objectives', 'flag_time').value = flag_time;
                this.ensureStat(poStats, 'objectives', 'toss_percent').value = toss_percent;
                this.ensureStat(poStats, 'objectives', 'touches_initial').value = touches_initial;

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

            switch (stats.teamRole) {
                case TeamRole.Offense:
                    stats.sg_kills += this.getSummarizedStat(player, 'kills', 'sg');
                    stats.concs += this.getSummarizedStat(player, 'weaponStats', 'concs');
                    stats.caps += this.getSummarizedStat(player, 'objectives', 'flag_capture');
                    stats.touches += this.getSummarizedStat(player, 'objectives', 'flag_touch');
                    stats.touches_initial += this.getSummarizedStat(player, 'objectives', 'touches_initial');

                    stats.toss_percent += this.getSummarizedStat(player, 'objectives', 'toss_percent')
                        * this.getSummarizedStat(player, 'objectives', 'flag_touch');

                    stats.flag_time = this.addTime(
                        stats.flag_time,
                        this.getSummarizedStat(player, 'objectives', 'flag_time').toString());

                    break;
                case TeamRole.Defense:
                    stats.airshots = this.getSummarizedStat(player, 'weaponStats', 'airshot');
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
        category: string,
        item: string,
        events: Event[],
        description?: string): GenericStat {

        const thisStat = this.ensureStat(playerStats, category, item, description);
        thisStat.value = events.length;
        thisStat.events = events;

        const facetedStat = this.generateStatDetails(category, thisStat);
        if (facetedStat != null) {
            thisStat.weapon_summary = facetedStat.weapon_summary;
            thisStat.details = facetedStat.details;
        }

        return thisStat;
    }

    private static generateStatDetails(category: string, stat: GenericStat): FacetedStat | undefined {
        const events = stat.events;
        if (events == null)
            return;

        switch (category) {
            case 'kills':
                switch (stat.title) {
                    case 'kill':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerTo?.name} at ${this.getTime(e)}`,
                            true);
                    case 'kill_while_conced':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Killed ${e.playerTo?.name} while conced at ${this.getTime(e)}`,
                            true);
                    case 'teamkill':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Team killed ${e.playerTo?.name} at ${this.getTime(e)}`,
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
                            (e) => `Killed by ${e.playerFrom?.name} at ${this.getTime(e)}`);
                    case 'by_team':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Team-killed by ${e.playerFrom?.name} at ${this.getTime(e)}`);
                    case 'by_self':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Suicided at ${this.getTime(e)}`);
                }
            case 'weaponStats':
                switch (stat.title) {
                    case 'airshot':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Airshot ${e.playerTo?.name} at ${this.getTime(e)} (${e.data?.value} meters)`,
                            true);
                    case 'airshoted':
                        return this.generateFacetedStats(stat.events!,
                            (e) => `Airshoted by ${e.playerFrom?.name} at ${this.getTime(e)} (${e.data?.value} meters)`);
                    default:
                        console.log(`generateStatDetails: not implemented: weaponStats > ${stat.title}`);
                }
            default:
                console.log(`generateStatDetails: not implemented: ${category} > ${stat.title}`)
        }
    }

    private static generateFacetedStats(events: Event[], descriptor: EventDescriptor, isByPlayer?: boolean): FacetedStat {
        const facetedDetails = {};
        const facetedWeaponCounts: { [key in Weapon]?: number } = {};
        const allDetails = events.map(e => (<StatDetails>{
            description: descriptor(e),
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
        return Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(e.gametime);
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
        } as TeamStats;

        switch (blankStats.teamRole) {
            case TeamRole.Offense:
                blankStats.sg_kills = 0;
                blankStats.concs = 0;
                blankStats.caps = 0;
                blankStats.touches = 0;
                blankStats.touches_initial = 0;
                blankStats.toss_percent = 0;
                blankStats.flag_time = "0:00";
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

        // flip so that order matches offense
        const defenseTeams = stats.map(roundStats => roundStats.teams[2]!.teamStats).reverse() as [DefenseTeamStats, DefenseTeamStats];

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
            concs: offenseTeams[0].concs - offenseTeams[1].concs,
            caps: offenseTeams[0].caps - offenseTeams[1].caps,
            touches: offenseTeams[0].touches - offenseTeams[1].touches,
            touches_initial: offenseTeams[0].touches_initial - offenseTeams[1].touches_initial,
            toss_percent: offenseTeams[0].toss_percent - offenseTeams[1].toss_percent,
            flag_time: this.diffTime(offenseTeams[0].flag_time, offenseTeams[1].flag_time),
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
            airshots: defenseTeams[1].airshots - defenseTeams[0].airshots,
        };

        return [offenseDiff, defenseDiff];
    }

    private static calculatePlayerFlagStats(thisPlayer: Player, playerEvents: Stats, flagEvents: Stats, matchEnd: Date): [string, number, number] {
        // Capture and pickup events are passed in via flagEvents;
        // also use 'team_death'/'death', and 'flag_thrown' events to calculate flag time.
        const deaths = playerEvents['death'];
        const team_deaths = playerEvents['team_death'];
        const self_deaths = playerEvents['suicide'];
        const flag_thrown = playerEvents['flag_throw'];

        // combine and sort entries to calculate flag time
        let flagCarries = 0;
        let initialTouches = 0;
        let flagThrows = 0;
        let flagTimeMS = 0;

        let flagSequence = deaths.concat(
            team_deaths, self_deaths, flag_thrown,
            flagEvents['flag_capture'], flagEvents['flag_return'], flagEvents['flag_pickup']);
        flagSequence.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

        // accumulator is [boolean, Event], where
        // * boolean is flag state: null = relay, false = dropped, true = carried
        // * Event is the event from the flag pickup; unset if not carried by this player
        let lastFlagSequence = flagSequence.reduce<[boolean | null, Event | undefined]>((flagStatus, thisEvent) => {
            // ignore undefined events (occurs whenever an event category has no items)
            if (thisEvent == null)
                return flagStatus;

            const eventType = thisEvent.eventType;

            // if the flag returned, set state to null
            if (eventType === EventType.FlagReturn) {
                return [null, undefined];
            }
            // the flag was captured; record the time if it was this player and set state to null
            if (eventType === EventType.PlayerCapturedFlag) {
                if (thisEvent.playerFrom?.matches(thisPlayer)) {
                    if (!flagStatus[1]!.playerFrom!.matches(thisPlayer)) {
                        console.error("Flag cap seen by a player (" + thisPlayer.name +") which wasn't carrying the flag"
                            + " (was carried by " + flagStatus[1]!.playerFrom!.name + ")");
                    }
                    flagTimeMS += thisEvent.timestamp.valueOf() - flagStatus[1]!.timestamp.valueOf();
                }
                return [null, undefined];
            }
            if (eventType === EventType.PlayerPickedUpFlag) {
                // did this player pick up the flag?
                if (thisEvent.playerFrom?.matches(thisPlayer)) {
                    flagCarries++;
                    // is this an initial touch?
                    if (flagStatus[0] === null) initialTouches++;

                    // record the time the flag was picked up, then continue
                    return [true, thisEvent];
                }
                // otherwise, mark flag as moved
                return [false, undefined];
            }

            // if the flag isn't currently being carried, skip
            if (!flagStatus[0] || flagStatus[1] === undefined)
                return flagStatus;

            // otherwise, the flag was dropped; reset flagStatus
            flagTimeMS += thisEvent.timestamp.valueOf() - flagStatus[1]!.timestamp.valueOf();

            if (eventType === EventType.PlayerThrewFlag)
                flagThrows++;

            return [false, undefined];
        }, [null, undefined]);

        if (lastFlagSequence[0]) {
            // The flag was being held when the game ended.
            flagTimeMS += (matchEnd.valueOf() - lastFlagSequence[1]!.timestamp.valueOf());
        }

        const flagTime = Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(flagTimeMS);
        const tossPercent = flagCarries > 0 ? Math.round(flagThrows / flagCarries * 100) : 0;

        return [flagTime, tossPercent, initialTouches];
    }

    private static calculateAndApplyPlayerClassOnAllEvents(player: Player, playerEvents: Stats, matchEnd: Date) {
        let roleChangedEvents = playerEvents['role'];
        roleChangedEvents.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

        let classTimes: ClassTime[] = [];
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
                if (statEvent.lineNumber == 1002) {
                    console.log(player.name + ": line 1002; curClassIndex " + curClassIndex + "; classTimes.length " + classTimes.length);
                    console.log(player);
                    console.log(statEvent.playerFrom);
                    console.log(statEvent.playerTo);
                    console.log(player == statEvent.playerTo);
                }
                if (player == statEvent.playerFrom) {
                    statEvent.playerFromClass = classTimes[curClassIndex].class;
                }
                if (player == statEvent.playerTo) {
                    statEvent.playerToClass = classTimes[curClassIndex].class;
                }
            });
        }

        return classTimes;
    }

    private static getConcTimeEffectDurationInSeconds(playerClass: PlayerClass | undefined) {
        const concTimeDurationInSeconds = 8;
        return playerClass != PlayerClass.Medic ? concTimeDurationInSeconds : (concTimeDurationInSeconds / 2);
    }

    private static calculateAndApplyWhileConcedOnAllEvents(player: Player, playerEvents: Stats) {
        if (!playerEvents) {
            return;
        }

        let concSequence = new Array<Event>()
            .concat(
                playerEvents['conc'],
                playerEvents['conc_jump'],
                playerEvents['team_concee'],
                playerEvents['concee'],
                playerEvents['death'],
                playerEvents['team_death'],
                playerEvents['suicide'])
            .filter(event => event != undefined && event !== null)
            .sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

        // Build a list of periods that the player was conced, as determined by the first conc event for the period
        // and the end time for when the player was no longer conced.
        let concPeriods = new Array<[Event, Date]>();
        let concStartEvent: Event | null = null;
        let concEndTimestamp = new Date(0);
        for (let curConcEventIndex = 0; curConcEventIndex < concSequence.length; curConcEventIndex++) {
            const concSequenceEvent = concSequence[curConcEventIndex];
            if (concSequenceEvent.eventType == EventType.PlayerConced) {
                if (concSequenceEvent.playerTo == player) {
                    if (concStartEvent != null && concSequenceEvent.timestamp < concEndTimestamp) {
                        // The player was conced again while conced; extend the period.
                        concEndTimestamp = new Date(concSequenceEvent.timestamp.getTime());
                        concEndTimestamp.setSeconds(concEndTimestamp.getSeconds() + ParserUtils.getConcTimeEffectDurationInSeconds(concSequenceEvent.playerToClass));
                    }
                    else {
                        if (concStartEvent != null) {
                            // Record the previous, now-ended conc.
                            concPeriods.push([concStartEvent, concEndTimestamp]);
                        }
                        // Track the new conc period.
                        concStartEvent = concSequenceEvent;
                        concEndTimestamp = new Date(concSequenceEvent.timestamp.getTime());
                        concEndTimestamp.setSeconds(concEndTimestamp.getSeconds() + ParserUtils.getConcTimeEffectDurationInSeconds(concSequenceEvent.playerToClass));
                    }
                }
            }
            else { // Death event.
                if (concStartEvent != null) {
                    if (concSequenceEvent.timestamp < concEndTimestamp) {
                        concEndTimestamp = concSequenceEvent.timestamp; // The death marks the end of the conc period.
                    }
                    concPeriods.push([concStartEvent, concEndTimestamp]);
                }
                concStartEvent = null;
                concEndTimestamp = new Date(0);
            }
        }
        if (concStartEvent != null) {
            concPeriods.push([concStartEvent, concEndTimestamp]);
        }

        for (const stat in playerEvents) {
            let statEvents = playerEvents[stat];
            statEvents.sort((a, b) => a.lineNumber > b.lineNumber ? 1 : -1);

            let curConcPeriodIndex = 0;
            statEvents.forEach((statEvent) => {
                // Advance through the array of conc periods until we reach one that ended after this event.
                while (curConcPeriodIndex < concPeriods.length && statEvent.timestamp > concPeriods[curConcPeriodIndex][1]) {
                    curConcPeriodIndex++;
                }
                // Check if the event fell within the period.
                if (curConcPeriodIndex < concPeriods.length) {
                    if (statEvent.lineNumber > concPeriods[curConcPeriodIndex][0].lineNumber
                        && statEvent.timestamp < concPeriods[curConcPeriodIndex][1]) {
                        statEvent.whileConced = true;
                    }
                }
            });
        }
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
