import app from './App';
import { Parser } from './parser';
import fileParser from './fileParser';

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
let parser = new Parser('logs/L0102102.log', 'logs/L0102104.log');
// let parser = new Parser('logs/L0405005.log');
// let parser = new Parser('logs/TSq9rtLa.log');
let parsePromise = parser.parseRounds();
parsePromise.then(fileParser);