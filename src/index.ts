import app from './App';
import Parser from './parser';
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
let parser = new Parser('logs/L1122101.log');
let parsePromise = parser.parseFile(); 
parsePromise.then(() => { 
    const stats = parser.stats;
    if (stats) {        
        readFile('src/html/test-template.html', 'utf-8', (error, source) => {
            const template = handlebars.compile(source);
            const html = template(stats);
            
            writeFile('src/html/' + stats!.log_name + '.html', html, err => {
                if (err) console.error("failed to write output: " + err);
                console.log('saved file');
            });
        });
    } else console.error("no stats found to write!");
});
