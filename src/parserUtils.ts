import PlayerList from "./playerList";
import { Event } from "./parser";
import Player from "./player";
import { TeamColor} from "./constants";
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
                        this.addStat(thisPlayerStats, 'flag_carry', event);
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
}
