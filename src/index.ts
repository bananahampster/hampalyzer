import app from './App';
import { Parser } from './parser';
import * as Handlebars from 'handlebars';
import { readFile, writeFile, mkdir, fstat } from 'fs';
import TemplateUtils from './templateUtils';
import ParserUtils from './parserUtils';
import { OutputPlayer, PlayerOutputStatsRound, PlayerOutputStats } from './constants';

const port = process.env.PORT || 3000;

// example of invocating a webserver/API
app.listen(port, err => {
    if (err) return console.log(err);
    return console.log(`server is listening on ${port}.`);
});

// for now, try to read the log file always

// let parser = new Parser('logs/Aiidw4yM.log');
// let parser = new Parser('logs/L1120011.log');
// let parser = new Parser('logs/L1120006.log', 'logs/L1120008.log');
// let parser = new Parser('logs/L0526012.log', 'logs/L0526013.log');
let parser = new Parser('logs/L0808010.log', 'logs/L0808012.log');
// let parser = new Parser('logs/L0405005.log');
// let parser = new Parser('logs/TSq9rtLa.log');
let parsePromise = parser.parseRounds(); 

const outputRoot = 'src/html';
parsePromise.then((allStats) => {
    if (allStats) {
        let templateFile = 'src/html/template-twoRds-stacked.html';
        const isSummary = allStats.stats.length === 2;
        if (isSummary)
            templateFile = 'src/html/template-summary.html';
        
        const playerTemplate = 'src/html/template-summary-player.html';

        const logName = allStats.stats[0]!.log_name
        const outputDir = `${outputRoot}/${logName}`;

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
    } else console.error('no stats found to write!');
});

// parsePromise.then((allStats) => { 
//     // const stats = parser.stats[0];
//     const stats = allStats.stats[0];
//     if (stats) {        
//         readFile('src/html/test-template.html', 'utf-8', (error, source) => {
//             const template = handlebars.compile(source);
//             const html = template(stats);
            
//             writeFile('src/html/' + stats!.log_name + '.html', html, err => {
//                 if (err) console.error("failed to write output: " + err);
//                 console.log('saved file');
//             });
//         });
//     } else console.error("no stats found to write!");
// });
