import { readFile, writeFile, mkdir } from 'fs';

import * as Handlebars from 'handlebars';

import { OutputPlayer, PlayerOutputStatsRound, PlayerOutputStats } from './constants';
import { ParsedStats } from "./parser";
import ParserUtils from './parserUtils';
import TemplateUtils from './templateUtils';


export default function(allStats: ParsedStats | undefined): string | undefined {
    if (allStats) {
        let templateFile = 'src/html/template-twoRds-stacked.html';
        const isSummary = allStats.stats.length === 2;
        if (isSummary)
            templateFile = 'src/html/template-summary.html';

        const playerTemplate = 'src/html/template-summary-player.html';

        const logName = allStats.stats[0]!.log_name
        const outputDir = `parsedlogs/${logName}`;

        // ensure directory exists; create if it doesn't
        mkdir(outputDir, { mode: 0o775, recursive: true, }, err => { if (err && err.code !== "EEXIST") throw err; });

        readFile(templateFile, 'utf-8', (error, source) => {
            TemplateUtils.registerHelpers();
            const template = Handlebars.compile(source);
            const html = template(allStats);

            const summaryOutput = `${outputDir}/index.html`;

            writeFile(summaryOutput, html, err => {
                if (err) console.error(`failed to write output: ${err}`);
                console.log(`saved file ${summaryOutput}`);
            });
        });

        // TODO: logic for generating player pages
        // * collect each player (allStats.players[team][index])
        // * for each player, collect their stats from available rounds and combine into
        //    { player, round: stats[] }  (see PlayerOutputStats)
        // generate page (compile template, generate template with filename w/steam_id number)
        const players = allStats.players;
        const playersStats: PlayerOutputStats[] = [];
        const matchMetadata = {
            map: allStats.stats[0]!.map,
            server: allStats.stats[0]!.server,
            date: allStats.stats[0]!.date,
            time: allStats.stats[0]!.time,
            players: allStats.players,
        };

        // assemble every players' stats
        [1, 2].forEach(teamId => {
            const team = players[teamId] as OutputPlayer[];
            for (const player of team) {
                let playerStats: PlayerOutputStatsRound[] = [];
                for (const round of allStats.stats) {
                    if (!round) continue;

                    const foundPlayer = ParserUtils.getPlayerFromTeams(player.steamID, round.teams);
                    if (foundPlayer)
                        playerStats.push(foundPlayer);
                }

                playersStats.push({
                    ...player,
                    ...matchMetadata,
                    round: playerStats,
                });
            }
        });

        // generate page for every player
        readFile(playerTemplate, 'utf-8', (error, source) => {
            TemplateUtils.registerHelpers();
            const playerHtml = Handlebars.compile(source);

            for (const playerStats of playersStats) {
                const html = playerHtml(playerStats);
                const playerOutput = `${outputDir}/p${playerStats.id}.html`;

                writeFile(playerOutput, html, err => {
                    if (err) console.error(`failed to write output: ${err}`);
                    console.log(`saved file ${playerOutput}`);
                });
            }
        });

        return outputDir;
    } else console.error('no stats found to write!');
}