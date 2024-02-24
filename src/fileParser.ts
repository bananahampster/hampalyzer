import { readFileSync, writeFile, mkdir } from 'fs';

import Handlebars from 'handlebars';
import * as pg from 'pg';

import { OutputPlayer, PlayerOutputStatsRound, PlayerOutputStats, ParseResponse, ParsingError } from './constants.js';
import { ParsedStats } from "./parser.js";
import ParserUtils from './parserUtils.js';
import TemplateUtils from './templateUtils.js';
import FlagPaceChart from './flagPace.js';
import { DB, MatchMetadata } from './database.js';

export interface HampalyzerTemplates {
    summary: HandlebarsTemplateDelegate<any>;
    player: HandlebarsTemplateDelegate<any>;
}

export default async function(
    allStats: ParsedStats | undefined,
    outputRoot: string = 'parsedlogs',
    templates?: HampalyzerTemplates,
    database?: DB,
    logId?: number,
): Promise<ParseResponse> {

    const useDB = !!database;

    if (allStats) {
        // collect team scores; assume that blue/red switch between rounds
        let teamScore = {
            1: allStats.stats[0]?.score[1] || 0,
            2: allStats.stats[0]?.score[2] || 0,
        };
        if (allStats.stats[1]) {
            teamScore[1] += allStats.stats[1].score[2] || 0;
            teamScore[2] += allStats.stats[1].score[1] || 0;
        }

        const matchMeta: MatchMetadata = {
            logName: allStats.stats[0]!.parse_name,
            logFile_1: allStats.stats[0]!.log_name,
            logFile_2: allStats.stats[1]?.log_name,
            date_match: allStats.stats[0]!.timestamp,
            map: allStats.stats[0]!.map,
            score: teamScore,
            server: allStats.stats[0]!.server,
            num_players: (allStats.players[1]?.length ?? 0) + (allStats.players[2]?.length ?? 0)
        };

        // depends on npm "prepare" putting template files in the right place (next to js)
        const templateDir = new URL('./templates/', import.meta.url);
        const templateFile = new URL('./template-summary.html', templateDir);
        const playerTemplate = new URL('./template-summary-player.html', templateDir);

        // if no pre-parsed templates were provided, get them from well-known places and compile
        if (!templates) {
            TemplateUtils.registerHelpers();
            templates = {
                summary: Handlebars.compile(readFileSync(templateFile, 'utf-8')),
                player:  Handlebars.compile(readFileSync(playerTemplate, 'utf-8')),
            }
        }

        if (useDB) {
            // if initial parse of this log, check for duplicate match: just return that URL if so
            if (!logId) {
                const isDuplicate = await database.checkLogDuplicate(matchMeta);
                if (isDuplicate) {
                    return {
                        success: true,
                        message: `${outputRoot}/${matchMeta.logName}`
                    };
                }
            }

            // guarantee unique log name for URI slug
            matchMeta.logName = await database.getUniqueLogName(matchMeta.logName, !!logId);
        }

        const outputDir = `${outputRoot}/${matchMeta.logName}`;

        // ensure directory exists; create if it doesn't
        mkdir(
            outputDir, 
            { mode: 0o775, recursive: true, }, 
            err => {
                if (err && err.code !== "EEXIST") 
                    throw new ParsingError({
                        name: 'PARSING_FAILURE',
                        message: err.message,
                    }); 
            });

        // generate the summary output
        let flagPaceChartMarkup = "";
        const summaryOutput = `${outputDir}/index.html`;

        if (allStats.stats.length > 0) {
            let flagPaceChart = new FlagPaceChart(allStats.stats.filter((stats) => !!stats?.scoring_activity).map((stats) => stats?.scoring_activity!));
            flagPaceChartMarkup = await flagPaceChart.getSvgMarkup();
        }

        const html = templates.summary({
            ...allStats,
            chartMarkup: flagPaceChartMarkup
        });

        writeFile(summaryOutput, html, err => {
            if (err) {
                console.error(`failed to write output: ${err}`);
                throw new ParsingError({
                    name: 'PARSING_FAILURE',
                    message: `Failed to write output: ${err}`,
                });
            }
        });

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
            damage_stats_exist: allStats.stats[0]!.damage_stats_exist
        };

        // assemble every players' stats
        [1, 2].forEach(teamId => {
            const team = players[teamId] || [] as OutputPlayer[];
            for (const player of team) {
                let playerStats: PlayerOutputStatsRound[] = [];
                for (let i = 0, len = allStats.stats.length; i < len; i++) {
                    const round = allStats.stats[i];
                    if (!round) continue;

                    const foundPlayer = ParserUtils.getPlayerFromTeams(player.steamID, round.teams);
                    if (foundPlayer)
                        playerStats.push({ ...foundPlayer, round_number: i+1 });
                }

                playersStats.push({
                    ...player,
                    ...matchMetadata,
                    round: playerStats,
                });
            }
        });

        // generate page for every player
        for (const playerStats of playersStats) {
            const html = templates.player(playerStats);
            const playerOutput = `${outputDir}/p${playerStats.id}.html`;

            writeFile(playerOutput, html, err => {
                if (err) {
                    console.error(`failed to write output: ${err}`);
                    throw new ParsingError({
                        name: 'PARSING_FAILURE',
                        message: `Failed to write output: ${err}`,
                    });
                }
            });
        }

        let dbSuccess = !useDB;
        
        // skip publishing to DB if this is a reparsed log
        if (useDB) {
            // if everything is successful up to this point, log into the database
            dbSuccess = await database.matchTransaction(allStats, matchMeta, logId);
        }

        // Append a forward slash to ensure we skip the nginx redirect which adds it anyway.
        // (which, when the server name had a '?', decodes %3F back into '?' which in turn results in a 404)
        if (dbSuccess || !logId) {
            console.log(`writing log to ${outputDir}`);
            return {
                success: true,
                message: `${outputDir}/`
            };
        } else {
            return {
                success: false,
                error_reason: 'DATABASE_FAILURE',
                message: "Failed to communicate to database.  The logs have been rejected.",
            }
        }
    }

    return {
        success: false,
        error_reason: 'PARSING_FAILURE',
        message: 'No stats found to write! Unhandled exception likely resulted in this error.'
    };
}
