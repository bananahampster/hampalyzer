import app from './App';
import Parser from './parser';

const port = process.env.PORT || 3000;

// example of invocating a webserver/API
// app.listen(port, err => {
//     if (err) return console.log(err);
//     return console.log(`server is listening on ${port}.`);
// });

// for now, try to read the log file always

let parser = new Parser('logs/Aiidw4yM.log');
let parsePromise = parser.parseFile();
parsePromise.then(() => { console.log(parser.data()); });
