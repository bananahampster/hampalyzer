import { Parser } from './parser.js';
import fileParser from './fileParser.js';
import App from './App.js';

import { existsSync } from 'fs';
import * as path from 'path';

const port = process.env.PORT || 3000;

// example of invocating a webserver/API

// either call to start a server or parse a log or two
// node index.js server [outputDir="parsedLogs"] [webserverRoot=""]
// node index.js [logFile1.log [logFile2.log]]

const programArgs = process.argv.slice(2);
if (programArgs.length > 0 && programArgs[0].toLocaleLowerCase() === 'server') {
    let outputRoot = "parsedLogs";
    let webserverRoot: string | undefined;
    if (programArgs[1])
        outputRoot = programArgs[1];

    if (programArgs[2])
        webserverRoot = programArgs[2];

    const outputDir = path.join(programArgs[2] || "", outputRoot);
    if (!existsSync(outputDir))
        throw `unable to bind to output directory: ${outputDir}`;

    const app = new App(webserverRoot, outputRoot).express;

    app.listen(port, err => {
        if (err) return console.log(err);
        return console.log(`server is listening on ${port}.`);
    });
}
else {
    let logs: string[] = [];
    if (programArgs.length != 0) {
        const maxLogs = Math.min(2, programArgs.length);
        for (let i = 0; i < maxLogs; i++) {
            if (!existsSync(programArgs[i]))
                throw `unable to find logs at ${programArgs[i]}`;

            logs.push(programArgs[i]);
        }
    }
    else
        // logs = ['logs/L0102102.log', 'logs/L0102104.log'];
        // logs = ['logs/1619406938938-L0425095.log', 'logs/1619406938938-L0425099.log']
        // logs = ['logs/JXt9zAen.log', 'logs/GJWd8vi5.log'];
        logs = ['logs/1629607551662-L0821092.log', 'logs/1629607551665-L0821093.log'];

    console.log(`parsing logs ${logs.join(" and ")} ...`);

    // for now, try to read the log file always

    // TODO: take 1-2 log files on argv

    // let parser = new Parser('logs/Aiidw4yM.log');
    // let parser = new Parser('logs/L1120011.log');
    // let parser = new Parser('logs/L1120006.log', 'logs/L1120008.log');
    // let parser = new Parser('logs/L0526012.log', 'logs/L0526013.log');
    let parser = new Parser(...logs);
    // let parser = new Parser('logs/L0405005.log');
    // let parser = new Parser('logs/TSq9rtLa.log');
    let parsePromise = parser.parseRounds();
    parsePromise.then(fileParser);
}