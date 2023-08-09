import { Parser } from './parser.js';
import fileParser from './fileParser.js';
import App from './App.js';

import { existsSync } from 'fs';
import * as path from 'path';

const port = process.env.PORT || 3000;

// example of invocating a webserver/API

// either call to start a server or parse a log or two
// node index.js server [outputDir="parsedLogs"] [webserverRoot=""] [--reparse]
// node index.js [logFile1.log [logFile2.log]]

const programArgs = process.argv.slice(2);
if (programArgs.length > 0 && programArgs[0].toLocaleLowerCase() === 'server') {
    let outputRoot = "parsedLogs";
    let webserverRoot: string | undefined;
    if (programArgs[1])
        outputRoot = programArgs[1];

    if (programArgs[2])
        webserverRoot = programArgs[2];

    let reparse = false;
    if (programArgs[3])
        reparse = programArgs[3].toLocaleLowerCase() === '--reparse';

    const outputDir = path.join(programArgs[2] || "", outputRoot);
    if (!existsSync(outputDir))
        throw `unable to bind to output directory: ${outputDir}`;

    const appClass = new App(webserverRoot, outputRoot);
    const app = appClass.express;

    app.listen(port, () => {

        if (reparse)
            appClass.reparseAllLogs();

        return console.log(`server is listening on ${port}.`);
    }).on("error", (err) => {
        return console.log(err);
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
        // logs = ['logs/1629607551662-L0821092.log', 'logs/1629607551665-L0821093.log'];
        // logs = ['logs/1640841656584-L1230036.log', 'logs/1640841656591-L1230037.log']; // stormz2
        // logs = ['logs/hellotnsbaconbowlr1.log', 'logs/hellotnsbaconbowlr2.log']; // baconbowl
        // logs = ['logs/hellothxtorch2r1.log', 'logs/hellothxtorch2r2.log']; // torch2
        // logs = ['logs/schtopr1.log', 'logs/schtopr2.log']; // incomplete
        // logs = ['logs/1641109721918-L0102072.log', 'logs/1641109721922-L0102073.log']; // siden
        // logs = ['dist/uploads/1647142313653-L0313008.log', 'dist/uploads/1647142313653-L0313009.log']; // teams fucked?
        logs = ['dist/uploads/1654325677960-L0604008.log', 'dist/uploads/1654325677973-L0604009.log']; // dmg not counted?

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