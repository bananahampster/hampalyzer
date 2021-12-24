import { copyFile, readFile, writeFile, mkdir } from 'fs';

import Handlebars from 'handlebars';
import * as pg from 'pg';

import * as path from 'path';

import { OutputPlayer, PlayerOutputStatsRound, PlayerOutputStats } from './constants.js';
import { ParsedStats } from "./parser.js";
import ParserUtils from './parserUtils.js';
import TemplateUtils from './templateUtils.js';
import FlagPaceChart from './flagPace.js';

interface MatchMetadata {
    logName: string;
    logFile_1: string;
    logFile_2: string | undefined;
    date_match: Date;
    map: string | undefined;
    server: string | undefined;
    num_players: number | undefined;
}


export default async function(
    allStats: ParsedStats | undefined,
    outputRoot: string = 'parsedlogs',
    pool?: pg.Pool,
    reparse?: boolean,
    ): Promise<string | undefined> {

    if (allStats) {
        const matchMeta: MatchMetadata = {
            logName: allStats.stats[0]!.parse_name,
            logFile_1: allStats.stats[0]!.log_name,
            logFile_2: allStats.stats[1]?.log_name,
            date_match: allStats.stats[0]!.timestamp,
            map: allStats.stats[0]!.map,
            server: allStats.stats[0]!.server,
            num_players: (allStats.players[1]?.length ?? 0) + (allStats.players[2]?.length ?? 0)
        };

        // check for duplicate match; just return that URL if so
        if (!reparse) {
            const isDuplicate = await checkHasDuplicate(pool, matchMeta);
            console.log('isDuplicate', isDuplicate);
            if (isDuplicate) return `${outputRoot}/${matchMeta.logName}`;
        }

        // depends on npm "prepare" putting template files in the right place (next to js)
        const templateDir = new URL('./templates/', import.meta.url);
        const templateFile = new URL('./template-summary.html', templateDir);
        const playerTemplate = new URL('./template-summary-player.html', templateDir);
        const cssFile = new URL('./hamp2.css', templateDir);

        const logName = await getLogName(pool, allStats.stats[0]!.parse_name, reparse);
        matchMeta.logName = logName;

        const outputDir = `${outputRoot}/${logName}`;

        // ensure directory exists; create if it doesn't
        mkdir(outputDir, { mode: 0o775, recursive: true, }, err => { if (err && err.code !== "EEXIST") throw err; });

        // the CSS file should stay in versioned with the output
        copyFile(cssFile, `${outputDir}/hamp2.css`, (error) => {
            if (error) console.error(`failed to copy CSS file: ${error}`);
            console.log(`copied CSS file`);
        });

        await readFile(templateFile, 'utf-8', (error, source) => {
            (async (source) => {
                TemplateUtils.registerHelpers();
                const template = Handlebars.compile(source);

                let flagPaceChartMarkup = "";
                const summaryOutput = `${outputDir}/index.html`;

                if (allStats.stats.length > 0) {
                    let flagPaceChart = new FlagPaceChart(allStats.stats.filter((stats) => !!stats?.scoring_activity).map((stats) => stats?.scoring_activity!));
                    flagPaceChartMarkup = await flagPaceChart.getSvgMarkup();
                }

                const html = template({
                    ...allStats,
                    chartMarkup: flagPaceChartMarkup
                });

                writeFile(summaryOutput, html, err => {
                    if (err) console.error(`failed to write output: ${err}`);
                    console.log(`saved file ${summaryOutput}`);
                });
            })(source);
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
            damage_stats_exist: allStats.stats[0]!.damage_stats_exist
        };

        // assemble every players' stats
        [1, 2].forEach(teamId => {
            const team = players[teamId] as OutputPlayer[];
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

        // skip publishing to DB if this is a reparsed log
        let dbSuccess = false;
        if (!reparse) {
            // if everything is successful up to this point, log into the database
            dbSuccess = await recordLog(pool, matchMeta);
        }

        // Append a forward slash to ensure we skip the nginx redirect which adds it anyway.
        // (which, when the server name had a '?', decodes %3F back into '?' which in turn results in a 404)
        return (dbSuccess || reparse) ? `${outputDir}/` : undefined;
    } else console.error('no stats found to write!');
}

async function checkHasDuplicate(pool: pg.Pool | undefined, matchMeta: MatchMetadata): Promise<boolean> {
    if (!pool) return false;

    return new Promise(function(resolve, reject) {
        pool.query(
            "SELECT COUNT(1) as cnt FROM logs WHERE parsedlog = $1 AND map = $2 AND server = $3 AND num_players = $4",
            [matchMeta.logName, matchMeta.map, matchMeta.server, matchMeta.num_players],
            (error, result) => {
                if (error)
                    console.error(`Failed to check for duplicates for ${matchMeta.logName}, proceeding anyway...`);
                    resolve(false);

                console.log("row is: ", result.rows[0]);
                console.log("cnt result", result.rows[0].cnt == 0);

                if (result.rows[0].cnt == 0)
                    resolve(false);

                console.log('resolving with logname: ', matchMeta.logName);
                resolve(true);
            }
        )
    });
}

async function getLogName(pool: pg.Pool | undefined, parse_name: string, reparse?: boolean): Promise<string> {
    if (!pool || !!reparse) return parse_name;

    return new Promise(function(resolve, reject) {
        pool.query(
            "SELECT COUNT(1) as cnt FROM logs WHERE parsedlog = $1",
            [parse_name],
            (error, result) => {
                if (error) {
                    console.error("Failed checking for logname collision: " + error);
                    reject("");
                }

                if (result.rows[0].cnt == 0)
                    resolve(parse_name);

                // otherwise, add some junk
                const junk = Math.random().toString(36).substr(2, 5); // 5-char string
                resolve(parse_name + '-' + junk);
            }
        );
    });
}

async function recordLog(pool: pg.Pool | undefined, matchMeta: MatchMetadata): Promise<boolean> {

    if (!pool) return true;

    return new Promise(function(resolve, reject) {
        pool.query(
        "INSERT INTO logs(parsedlog, log_file1, log_file2, date_parsed, date_match, map, server, num_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
            matchMeta.logName,
            matchMeta.logFile_1,
            matchMeta.logFile_2,
            new Date(),
            matchMeta.date_match,
            matchMeta.map,
            matchMeta.server,
            matchMeta.num_players
        ],
        (error, result) => {
            if (error) {
                console.error("Failed pushing new match log entry: " + error);
                return reject(false);
            }

            resolve(true);
        });
    });
}