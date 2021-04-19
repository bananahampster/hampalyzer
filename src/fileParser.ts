import { readFile, writeFile, mkdir } from 'fs';

import * as Handlebars from 'handlebars';
import pg = require('pg');

let path = require('path');

import { OutputPlayer, PlayerOutputStatsRound, PlayerOutputStats } from './constants';
import { ParsedStats } from "./parser";
import ParserUtils from './parserUtils';
import TemplateUtils from './templateUtils';


export default async function(allStats: ParsedStats | undefined, outputRoot: string = 'parsedlogs', pool?: pg.Pool): Promise<string | undefined> {
    if (allStats) {
        // depends on npm "prepare" putting template files in the right place (next to js)
        const templateDir = path.resolve(__dirname, 'templates/');

        const templateFile = path.join(templateDir, 'template-summary.html');
        const playerTemplate = path.join(templateDir, 'template-summary-player.html');

        const logName = await getLogName(pool, allStats.stats[0]!.log_name);

        const outputDir = `${outputRoot}/${logName}`;

        // ensure directory exists; create if it doesn't
        mkdir(outputDir, { mode: 0o775, recursive: true, }, err => { if (err && err.code !== "EEXIST") throw err; });

        // TODO: actually fill in flagStats
        allStats.stats[0]!.flagStats = [{
            player: "hampisthebest",
            how_dropped: 0,
            timestamp: "LOLZ"
        }];

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

        // if everything is successful up to this point, log into the database
        const dbSuccess = await recordLog(
            pool,
            logName,
            allStats.stats[0]!.log_name,
            allStats.stats[1]?.log_name,
            allStats.stats[0]!.timestamp,
            allStats.stats[0]!.map,
            allStats.stats[0]!.server,
            (allStats.players[1]?.length ?? 0) + (allStats.players[2]?.length ?? 0)
        );

        return dbSuccess ? outputDir : undefined;
    } else console.error('no stats found to write!');
}

async function getLogName(pool: pg.Pool | undefined, firstLogName: string): Promise<string> {
    if (!pool) return firstLogName;

    return new Promise(function(resolve, reject) {
        pool.query(
            "SELECT COUNT(1) FROM logs WHERE parsedlog = $1",
            [firstLogName],
            (error, result) => {
                if (error) {
                    console.error("Failed checking for logname collision: " + error);
                    reject("");
                }

                if (result.rows[0] === 0)
                    resolve(firstLogName);

                // otherwise, add some junk
                const junk = Math.random().toString(36).substr(2, 5); // 5-char string
                resolve(firstLogName + junk);
            }
        );
    });
}

async function recordLog(
    pool: pg.Pool | undefined,
    logName: string,
    logFile_1: string,
    logFile_2: string | undefined,
    date_match: Date,
    map: string | undefined,
    server: string | undefined,
    num_players: number | undefined): Promise<boolean> {

    if (!pool) return true;

    return new Promise(function(resolve, reject) {
        pool.query(
        "INSERT INTO logs(parsedlog, log_file1, log_file2, date_parsed, date_match, map, server, num_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [logName, logFile_1, logFile_2, new Date(), date_match, map, server, num_players],
        (error, result) => {
            if (error) {
                console.error("Failed pushing new match log entry: " + error);
                return reject(false);
            }

            resolve(true);
        });
    });
}