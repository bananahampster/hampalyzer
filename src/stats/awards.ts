import {
    OutputPlayer,
    OutputStats,
    TeamComposition,
    TeamOutputStatsDetailed,
} from "../models/types.js";

export function setGameAwards(teamComp: TeamComposition<OutputPlayer>, stats: (OutputStats | undefined)[]): void {
    const mvpPoints: { [playerKey: string]: number } = {};

    [1, 2].forEach(team => {
        teamComp[team]?.forEach(player => {
            mvpPoints[player.id] = 0;
        });
    });

    for (const roundStats of stats) {
        [1, 2].forEach(teamID => {
            if (!roundStats) {
                return;
            }

            const team: TeamOutputStatsDetailed = roundStats.teams[teamID]!;
            for (const player of team.players) {
                let points = 0;
                if (player.kills.kill) {
                    points += 0.7 * player.kills.kill.value;
                }
                if (player.kills.sg) {
                    points += 2.8 * player.kills.sg.value;
                }
                if (player.objectives?.flag_touch) {
                    points += 1.4 * player.objectives.flag_touch.value;
                }
                if (player.objectives?.touches_initial) {
                    points += 2.2 * player.objectives.touches_initial.value;
                }
                if (player.kills.teamkill) {
                    points -= player.kills.teamkill.value;
                }
                if (player.objectives?.flag_capture_bonus) {
                    points += 5 * player.objectives.flag_capture_bonus.value;
                }

                if (mvpPoints[player.id] != null) {
                    mvpPoints[player.id] += points;
                }
            }
        });
    }

    let topPlayer = "";
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
            if (!roundStats) {
                return;
            }

            const team: TeamOutputStatsDetailed = roundStats.teams[teamID]!;
            for (const player of team.players) {
                if (player.id === topPlayer) {
                    player.is_mvp = true;
                    break;
                }
            }
        });
    }
}
