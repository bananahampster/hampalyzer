import cors from 'cors';
import express from 'express';
import Handlebars from 'handlebars';
import multer from 'multer';
import pg from 'pg';

import { readFileSync } from 'fs';
import path from 'path';

import { default as fileParser, HampalyzerTemplates, ParsedPath } from './fileParser.js';
import { isParsedStats, ParsedStats, Parser } from './parser.js';
import TemplateUtils from './templateUtils.js';

type ParsedResult = ParsedPath | ParsedError;

interface ParsedError {
    error: string;
}

function isParsedError(parsedError: ParsedResult): parsedError is ParsedError {
    if ((parsedError as ParsedError).error !== undefined)
        return true;

    return false;
}

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
    private templates: HampalyzerTemplates;
    private readonly PAGE_SIZE: number = 20;

    constructor(private webserverRoot = "", private outputRoot = "parsedlogs", reparse = false) {
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

        // initialize the handlebars templates to be used globally
        const templateDir = new URL('./templates/', import.meta.url);
        const templateFile = new URL('./template-summary.html', templateDir);
        const playerTemplate = new URL('./template-summary-player.html', templateDir);

        TemplateUtils.registerHelpers();
        this.templates = {
            summary: Handlebars.compile(readFileSync(templateFile, 'utf-8')),
            player:  Handlebars.compile(readFileSync(playerTemplate, 'utf-8')),
        };
    }

    public async reparseAllLogs(): Promise<void> {
        const success = await this.reparseLogs();
        if (!success) {
            console.error("failed to reparse all logs; there may be a corresponding error above.");
            return process.exit(-10);
        }
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

            let parsedResult = await this.parseLogs([
                req.files[0].path,
                req.files[1].path]);

            if (parsedResult == null) {
                res.status(500).json({ error: "Failed to parse file (please pass logs to Hampster)" });
            } else if (isParsedError(parsedResult)) {
                res.status(500).json({ error: parsedResult.error })
            } else {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                let outputPath = parsedResult.path;
                if (outputPath.startsWith(this.webserverRoot)) {
                    outputPath = outputPath.slice(this.webserverRoot.length);
                }

                res.status(200).json({ success: { path: outputPath }});
            }
        });

        router.post('/parseLog', cors(), upload.single('logs[]'), async (req, res) => {
            // res.status(500).json({ error: "Single log parsing is still a work in progress; try uploading two rounds of a game instead." });

            let parsedResult = await this.parseLogs([req.file.path]);

            if (parsedResult == null) {
                res.status(500).json({ error: "Failed to parse file (please pass logs to Hampster)" });
            } else if (isParsedError(parsedResult)) {
                res.status(500).json({ error: parsedResult.error })
            } else {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                let outputPath = parsedResult.path;
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
        let result;
        try {
            result = await this.pool.query('SELECT log_file1, log_file2 FROM logs WHERE id > 42'); // before 42, wrong log filenames
            // for (const game of result.rows) {
            for (let i = 0, len = result.rows.length; i < len; i++) {
                const game = result.rows[i];

                const filenames: string[] = [];
                filenames.push(game.log_file1);
                if (game.log_file2 != null && game.log_file2 != "") {
                    filenames.push(game.log_file2);
                }

                console.warn(`${i+1} / ${len} (${Math.round((i+1) / len * 1000) / 10}%) reparsing: ${filenames.join(" +  ")}`);

                const parsedLog = await this.parseLogs(filenames, true /* reparse */);
                if (!parsedLog || isParsedError(parsedLog)) {
                    console.error(`failed to parse logs ${filenames.join(" + ")} for reason: ${parsedLog?.error}; aborting`);
                    return false;
                }
            }
        } catch (error: any) {
            console.error("critical error: failed to connect to DB to reparse logs: " + error?.message);
        }

        // at least some logs must have been reparsed
        return result && result.rows.length !== 0;
    }

    private parseLogs(filenames: string[], reparse?: boolean): Promise<ParsedResult | undefined> {
        const parser = new Parser(...filenames)

        return parser.parseRounds()
            .then(
                allStats => {
                    if (isParsedStats(allStats))
                        return fileParser(allStats, path.join(this.webserverRoot, this.outputRoot), this.templates, this.pool, reparse);

                    // return { error: "An unknown, unthrown error occurred" };
                },
                (error: string) => ({ error })
            );
    }
}

export default App;