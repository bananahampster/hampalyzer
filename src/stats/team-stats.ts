import PlayerList from "../models/player-list.js";
import {
    DefenseTeamStats,
    OffenseTeamStats,
    OutputPlayer,
    OutputStats,
    TeamColor,
    TeamComposition,
    TeamRole,
    TeamStatsComparison,
} from "../models/types.js";
import type { RoundParser } from "../parsing/round-parser.js";

export type TeamScore = { [team in TeamColor]?: number };

export function generateTeamComposition(rounds: RoundParser[]): TeamComposition<OutputPlayer> | undefined {
    const playerLists = rounds.map(round => round.playerList) as PlayerList[];

    const numRd1BluePlayers = num(playerLists[0].teams[1]);
    const numRd2BluePlayers = num(playerLists[1].teams[1]);
    const threshold = Math.floor(Math.max(numRd1BluePlayers, numRd2BluePlayers) / 2);
    if (Math.abs(numRd1BluePlayers - numRd2BluePlayers) > threshold) {
        return undefined;
    }

    const teamComp: TeamComposition<OutputPlayer> = {
        1: playerLists[0].teams[1]?.map(player => player.dumpOutput()),
        2: playerLists[0].teams[2]?.map(player => player.dumpOutput()),
    };

    playerLists[1].teams[2]?.forEach(player => {
        if (!teamComp[1]?.some(rd1Player => player.matches(rd1Player))) {
            teamComp[1]?.push(player.dumpOutput());
        }
    });

    playerLists[1].teams[1]?.forEach(player => {
        if (!teamComp[2]?.some(rd1Player => player.matches(rd1Player))) {
            teamComp[2]?.push(player.dumpOutput());
        }
    });

    return teamComp;
}

export function playerListToOutput(playerList: PlayerList): TeamComposition<OutputPlayer> {
    return {
        1: playerList.teams[1] ? playerList.teams[1].map(player => player.dumpOutput()) : undefined,
        2: playerList.teams[2] ? playerList.teams[2].map(player => player.dumpOutput()) : undefined,
    };
}

export function generateTeamRoleComparison(stats: [OutputStats, OutputStats]): TeamStatsComparison {
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

function num<T>(arr: T[] | undefined): number {
    return arr?.length ?? 0;
}
