import app from './App';
import { Parser } from './parser';
import * as handlebars from 'handlebars';
import { readFile, writeFile } from 'fs';

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
let parser = new Parser('logs/TSq9rtLa.log');
let parsePromise = parser.parseRounds(); 

parsePromise.then((allStats) => {
    if (allStats) {
        readFile('src/html/template-twoRds-stacked.html', 'utf-8', (error, source) => {
            const template = handlebars.compile(source);
            const html = template(allStats);
            const filename = `src/html/2rd-${allStats.stats[0]!.log_name}-stacked.html`;

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
