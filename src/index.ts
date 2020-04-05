import app from './App';
import { Parser } from './parser';
import * as Handlebars from 'handlebars';
import { readFile, writeFile } from 'fs';
import TemplateUtils from './templateUtils';

const port = process.env.PORT || 3000;

// example of invocating a webserver/API
// app.listen(port, err => {
//     if (err) return console.log(err);
//     return console.log(`server is listening on ${port}.`);
// });

// for now, try to read the log file always

// let parser = new Parser('logs/Aiidw4yM.log');
// let parser = new Parser('logs/L1120011.log');
// let parser = new Parser('logs/L1120006.log', 'logs/L1120008.log');
// let parser = new Parser('logs/L0322020.log', 'logs/L0322021.log');
let parser = new Parser('logs/L0405001.log');
// let parser = new Parser('logs/TSq9rtLa.log');
let parsePromise = parser.parseRounds(); 

parsePromise.then((allStats) => {
    if (allStats) {
        let templateFile = 'src/html/template-twoRds-stacked.html';
        let isSummary = allStats.stats.length === 2;
        if (isSummary)
            templateFile = 'src/html/template-summary.html';

        readFile(templateFile, 'utf-8', (error, source) => {
            TemplateUtils.registerHelpers();
            const template = Handlebars.compile(source);
            const html = template(allStats);
            
            const filename = `src/html/2rd-${allStats.stats[0]!.log_name}-${isSummary ? 'summary' : 'stacked'}.html`;

            writeFile(filename, html, err => {
                if (err) console.error(`failed to write output: ${err}`);
                console.log(`saved file ${filename}`);
            });
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
