import PlayerList from "./playerList";
import { Event } from "./parser";
import Player from "./player";
import { TeamColor, OutputStats, OutputPlayerStats, PlayerClass} from "./constants";
import EventType from "./eventType";

export type TeamComposition = { [team in TeamColor]?: Player[]; };
export type TeamScore = { [team in TeamColor]?: number; };
export type PlayerStats = { [playerID: string]: Stats };
export type Stats = { [stat: string]: Event[] };

export default class ParserUtils {
    public static getPlayerTeams(events: Event[], playerList: PlayerList): TeamComposition {
        let teams: TeamComposition = {};
        const teamChangeEvents = events.filter(ev => ev.eventType === EventType.PlayerJoinTeam);
        
        const playerTeams: { [playerID: string]: { timestamp: number, team: TeamColor }[] } = {};
        teamChangeEvents.forEach(event => {
            // find the player in the team list; add if it isn't there
            const player = event.playerFrom as Player;
            let playerRecord = playerTeams[player.steamID]
            if (!playerRecord)
                playerRecord = playerTeams[player.steamID] = [];

            const team = event.data && event.data.team;
            if (!team) throw "expected team with a 'joined team' event";
            
            playerRecord.push({ timestamp: event.timestamp.getTime(), team: team });
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

    public static getScore(events: Event[]): TeamScore {
        const teamScoreEvents = events.filter(ev => ev.eventType === EventType.TeamScore);
        let scores: TeamScore = {};
        
        teamScoreEvents.forEach(event => {
            const team = event.data && event.data.team;
            const score = event.data && event.data.value;
            if (!team) throw "expected team with a teamScore event";
            if (!score) throw "expected value with a teamScore event";
            scores[team] = Number(score);
        });

        return scores;
    }

    public static getPlayerStats(events: Event[], teams: TeamComposition): PlayerStats {
        // sort the events
        let playerStats: PlayerStats = {};
        for (const event of events) {
            // only deal with player events
            if (!event.playerFrom)
                continue;

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
                        break;
                    case EventType.PlayerThrewFlag:
                        this.addStat(thisPlayerStats, 'flag_throw', event);
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
                            this.addStat(thisPlayerStats, 'conc_jump', event);
                            this.addStat(otherPlayerStats, 'team_concee', event)
                        } else {
                            this.addStat(thisPlayerStats, 'conc_jump', event);
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

    private static addStat(stats: Stats, key: string, event: Event) {
        if (!stats[key])
            stats[key] = [];
        
        stats[key].push(event);
    }

    private static getPlayerFromStats(playerStats: PlayerStats, player: Player): Stats {
        let thisPlayerStats = playerStats[player.steamID];
        if (!thisPlayerStats)
            thisPlayerStats = playerStats[player.steamID] = {};

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

    public static generateOutputStats(events: Event[], stats: PlayerStats, playerList: PlayerList, teams: TeamComposition): OutputStats {
        // map
        const mapEvent = events.find(event => event.eventType === EventType.MapLoading);
        const map = mapEvent && mapEvent.value || "(not found)";

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
        const server = serverEvent && serverEvent.value || "(not found)";

        // log name (server [up to 10 char or first word boundary], date string, time)
        let serverShortName = server.split(/\s+/)[0];
        if (serverShortName.length > 10) serverShortName = serverShortName.slice(0, 10);
        const logName = [serverShortName, year, month, dayOfMonth, time.replace(":", "-")].join("-");

        // game time (should we calculate this somewhere else?)
        const prematchEndEvent = events.find(event => event.eventType === EventType.PrematchEnd);
        const matchEndEvent = events.find(event => event.eventType === EventType.TeamScore);
        
        const matchStart = prematchEndEvent && prematchEndEvent.timestamp || firstTimestamp;
        const matchEnd = matchEndEvent && matchEndEvent.timestamp || events[events.length - 1].timestamp;

        const gameTime = Intl.DateTimeFormat('en-US', { minute: '2-digit', second: '2-digit' })
            .format(matchEnd.valueOf() - matchStart.valueOf());

        const players = this.generateOutputPlayerStats(stats, playerList, teams, matchEnd);
        const score = this.getScore(events);

        return {
            log_name: logName,
            map,
            date,
            time,
            game_time: gameTime,
            server,
            players,
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

    public static generateOutputPlayerStats(
        stats: PlayerStats,
        players: PlayerList,
        teams: TeamComposition,
        matchEnd: Date): OutputPlayerStats[] {

        // calculate stats per player
        let outputStats: OutputPlayerStats[] = [];

        // iterate through the players identified as playing on the teams of interest (for now, Blue and Red)
        [1, 2].forEach(team => {
            const teamPlayerIDs = (teams[String(team)] as Player[]).map(player => player.steamID);

            for (const playerID of teamPlayerIDs) {
                let poStats: OutputPlayerStats = this.blankOutputPlayerStats(team);
                poStats.name = players.getPlayer(playerID)!.name;
                poStats.steam_id = playerID;
    
                const playerStats = stats[playerID];
                for (const stat in playerStats) {
                    const statEvents = playerStats[stat];
    
                    switch (stat) {
                        case 'flag_capture':
                            poStats.caps = statEvents.length; break;
                        case 'conc_jump':
                            poStats.concs = statEvents.length; break;
                        case 'death': 
                            poStats.deaths = statEvents.length; break;
                        case 'flag_pickup':
                            poStats.touches = statEvents.length;
                            break;
                        case 'kill':
                            poStats.kills = statEvents.length; break;
                        case 'got_button':
                            poStats.obj = statEvents.length; break;
                        case 'kill_sg':
                            poStats.sg_kills = statEvents.length; break;
                        case 'suicide':
                            poStats.suicides = statEvents.length; break;
                        case 'team_death':
                            poStats.team_deaths = statEvents.length; break;
                        case 'team_kill':
                            poStats.team_kills = statEvents.length; break;
                        case 'role':
                            poStats.roles = this.getPlayerClasses(statEvents, matchEnd);
                            break;
                    }
                }

                [poStats.flag_time, poStats.toss_percent] = this.calculatePlayerFlagStats(playerStats);

                outputStats.push(poStats);
            }

            // do the stupid thing and order players by number of frags
            outputStats.sort((a, b) => a.team === b.team ? b.kills - a.kills : 0);
        });

        return outputStats;
    }

    private static blankOutputPlayerStats(team: number = 5): OutputPlayerStats {
        return {
            name: "(unknown)",
            team: team,
            steam_id: "(unknown)",
            roles: "(unknown)",
            caps: 0,
            concs: 0,
            deaths: 0,
            flag_time: "0:00",
            kills: 0,
            obj: 0,
            sg_kills: 0,
            suicides: 0,
            team_deaths: 0,
            team_kills: 0,
            toss_percent: 0,
            touches: 0,
        };
    }

    private static calculatePlayerFlagStats(playerEvents: Stats): [string, number] {
        // use 'flag_pickup', 'flag_capture', 'team_death'/'death', 'and (future) 'flag_thrown' events to calculate flag time
        const flagPickups = playerEvents['flag_pickup'];
        const flagCapture = playerEvents['flag_capture'];
        const deaths = playerEvents['death'];
        const team_deaths = playerEvents['team_death'];
        const flag_thrown = playerEvents['flag_throw'];

        // don't bother trying to calculate flag stats if there were no touches
        if (flagPickups == null || flagPickups.length == 0)
            return ["0:00", 0];

        // combine and sort entries to calculate flag time
        const flagCarries = flagPickups.length;
        let flagThrows = 0;
        let flagTimeMS = 0;

        let flagSequence = flagPickups.concat(flagCapture, deaths, team_deaths, flag_thrown);
        flagSequence.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1);

        flagSequence.reduce<[boolean, Date | undefined]>((flagStatus, thisEvent) => {
            // ignore undefined events (occurs whenever an event category has no items)
            if (thisEvent == null)
                return flagStatus; 

            // record the time the flag was picked up, then continue
            if (thisEvent.eventType === EventType.PlayerPickedUpFlag)
                return [true, thisEvent.timestamp];

            // if the flag isn't currently being carried, skip
            if (!flagStatus[0] || flagStatus[1] === undefined)
                return flagStatus;

            // otherwise, the flag was dropped; reset flagStatus
            flagTimeMS += thisEvent.timestamp.valueOf() - flagStatus[1]!.valueOf();
            
            if (thisEvent.eventType === EventType.PlayerThrewFlag)
                flagThrows++;

            return [false, undefined];
        }, [false, undefined]);

        const flagTime = Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(flagTimeMS);
        const tossPercent = Math.round(flagThrows / flagCarries * 100);

        return [flagTime, tossPercent];
    }

    private static getPlayerClasses(roleChangedEvents: Event[], matchEnd: Date): string {
        // collect times of classes; rank by most-played to least
        roleChangedEvents.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1);
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
