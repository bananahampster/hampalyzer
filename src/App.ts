import * as express from 'express';
import cors = require('cors');
import multer = require('multer');

import fileParser from './fileParser';
import { Parser } from './parser';
import path = require('path');

import pg = require('pg');

// see https://github.com/expressjs/multer
// and https://medium.com/@petehouston/upload-files-with-curl-93064dcccc76
// and ...?
let storage = multer.diskStorage({
    destination: 'uploads',
    filename: function(req, file, cb) {
        const now = req.body.date || Date.now();
        cb(null, now + "-" + file.originalname);
    }
})
let upload = multer({
    storage,
    limits: {
        fileSize: 2000000,
    }
});

class App {
    public express: express.Express;
    private pool: pg.Pool;
    private readonly PAGE_SIZE: number = 20;

    constructor(private webserverRoot = "", private outputRoot = "parsedlogs") {
        this.express = express();
        this.mountRoutes();

        // create database connection pool
        this.pool = new pg.Pool({
            user: process.env.HAMPALYZER_DB_USER,
            password: process.env.HAMPALYZER_DB_PASSWORD,
            host: 'localhost',
            database: 'hampalyzer',
            port: 5432,
        });
    }

    private mountRoutes(): void {
        const router = express.Router();
        router.get('/', (req, res) => {
            res.json({
                message: 'Hello world!',
            });
        });

        router.post('/parseGame', cors(), upload.array('logs[]', 2), async (req, res) => {
            if (req?.files['logs']?.length < 2) {
                console.error("expected two files");
            }

            let outputPath = await this.parseLogs([
                req.files[0].path,
                req.files[1].path]);

            if (outputPath == null) {
                res.status(500).json({ error: "Failed to parse file (please pass logs to Hampster)" });
            } else {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                if (outputPath.startsWith(this.webserverRoot)) {
                    outputPath = outputPath.slice(this.webserverRoot.length);
                }

                res.status(200).json({ success: { path: outputPath }});
            }
        });

        router.post('/parseLog', cors(), upload.single('logs[]'), async (req, res) => {
            // res.status(500).json({ error: "Single log parsing is still a work in progress; try uploading two rounds of a game instead." });

            let outputPath = await this.parseLogs([req.file.path]);

            if (outputPath == null) {
                res.status(500).json({ error: "Failed to parse file (please pass logs to Hampster)" });
            } else {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                if (outputPath.startsWith(this.webserverRoot)) {
                    outputPath = outputPath.slice(this.webserverRoot.length);
                }

                res.status(200).json({ success: { path: outputPath }});
            }
        });

        router.get('/logs/:page_num', async (req, res) => {
            const page_num = req.params['page_num'] || 1;

            this.pool.query(
                'SELECT * FROM logs ORDER BY date_parsed DESC LIMIT $1 OFFSET (($2 - 1) * $1)',
                [this.PAGE_SIZE, page_num],
                (error, result) => {
                    if (error)
                        res.status(500).json({ error: "Database failure: " + error });
                    else
                        res.status(200).json(result.rows);
                }
            );
        });

        this.express.use('/', router);
    }

    /** Attempts to re-parse all the successfully-parsed logs present in the database.
     * Succeeds if there are no errors, and if the source log files are missing, skips them.
     * Fails if any previous log fails to parse.
     **/
    private async reparseLogs(): Promise<boolean> {
        const allPromises: Promise<string | undefined>[] = [];
        this.pool.query(
            'SELECT * FROM logs',
            (error, result) => {
                if (error) {
                    console.error("crtical error: failed to connect to DB to reparse logs: " + error.message);
                }

                for (const game of result.rows) {
                    const filenames: string[] = [];
                    filenames.push(game.log_file1);
                    if (game.log_file2 != null && game.log_file2 != "") {
                        filenames.push(game.log_file2);
                    }

                    allPromises.push(this.parseLogs(filenames, true /* reparse */));
                }
            }
        );

        // ensure that all passed
        const results = await Promise.all(allPromises);
        return !results.some(result => result == null);
    }

    private parseLogs(filenames: string[], reparse?: boolean): Promise<string | undefined> {
        let parser = new Parser(...filenames)

        return parser.parseRounds()
            .then(allStats => fileParser(allStats, path.join(this.webserverRoot, this.outputRoot), this.pool, reparse));
    }
}

export default App;