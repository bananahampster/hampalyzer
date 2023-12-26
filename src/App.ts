import dotenv from 'dotenv';
import url from 'url';
import cors from 'cors';
import express from 'express';
import Handlebars from 'handlebars';
import multer from 'multer';
import pg from 'pg';

import { readFileSync } from 'fs';
import path from 'path';

import { FileCompression } from './fileCompression.js';
import { default as fileParser, HampalyzerTemplates } from './fileParser.js';
import { ParsedStats, Parser } from './parser.js';
import TemplateUtils from './templateUtils.js';
import { ParseResponse, ParsingError, ParsingOptions } from './constants.js';

const envFilePath = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: envFilePath });

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
        fileSize: 3000000,
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
            if (req.files && (req.files as Express.Multer.File[]).length < 2) {
                res.status(400).json({ failure: { message: "expected two files in `logs[]`"}});
                return;
            }

            const skipValidation = !!req.body.force;
            const parserResponse = await this.parseLogs([
                req.files![0].path,
                req.files![1].path],
                { skipValidation });

            if (parserResponse.success) {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                let outputPath = parserResponse.message;
                if (outputPath.startsWith(this.webserverRoot)) {
                    outputPath = outputPath.slice(this.webserverRoot.length);
                }

                res.status(200).json({ success: { path: outputPath }});
            }
            else {
                const { error_reason, message } = parserResponse;
                res.status(400).json({ failure: { error_reason, message } });
            }
        });

        router.post('/parseLog', cors(), upload.single('logs[]'), async (req, res) => {
            const skipValidation = !!req.body.force;
            const parserResponse = await this.parseLogs([req.file!.path], { skipValidation });
            if (parserResponse.success) {
                // sanitize the outputPath by removing the webserverRoot path
                // (e.g., remove /var/www/app.hampalyzer.com/html prefix)
                let outputPath = parserResponse.message;
                if (outputPath.startsWith(this.webserverRoot)) {
                    outputPath = outputPath.slice(this.webserverRoot.length);
                }

                res.status(200).json({ success: { path: outputPath }});
            }
            else {
                const { error_reason, message } = parserResponse;
                res.status(400).json({ failure: { error_reason, message } });
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
            result = await this.pool.query('SELECT id, log_file1, log_file2 FROM logs WHERE id > 42'); // before 42, wrong log filenames
            for (let i = 0, len = result.rows.length; i < len; i++) {
                const game = result.rows[i];

                const filenames: string[] = [];
                filenames.push(game.log_file1);
                if (game.log_file2 != null && game.log_file2 != "") {
                    filenames.push(game.log_file2);
                }

                console.warn(`${i+1} / ${len} (${Math.round((i+1) / len * 1000) / 10}%) reparsing: ${filenames.join(" + ")}`);

                const parsedLog = await this.parseLogs(filenames, { reparse: true });
                if (!parsedLog.success) {
                    // if it is a validation failure, mark it and move on to the next log.
                    if (parsedLog.error_reason === 'MATCH_INVALID') {
                        console.error(`LOG ${game.id} invalid: ${parsedLog.message}`);
                        this.pool.query('UPDATE logs SET is_valid = FALSE WHERE id = $1', [game.id]);
                        continue;
                    }
                    else {
                        console.error(`failed to parse logs ${filenames.join(" + ")}; aborting`);
                        return false;
                    }
                }
            }
        } catch (error: any) {
            console.error("critical error: failed to connect to DB to reparse logs: " + error?.message || error);
        }

        // at least some logs must have been reparsed
        return result && result.rows.length !== 0;
    }

    private async parseLogs(filenames: string[], { reparse, skipValidation }: ParsingOptions): Promise<ParseResponse> {
        filenames = await FileCompression.ensureFilesCompressed(filenames, /*deleteOriginals=*/true);
        const parser = new Parser(...filenames)

        return parser.parseRounds(skipValidation)
            .then(allStats => fileParser(allStats, path.join(this.webserverRoot, this.outputRoot), this.templates, this.pool, reparse))
            .catch((error) => {
                if (error instanceof ParsingError) {
                    return <ParseResponse>{
                        success: false,
                        error_reason: error.name,
                        message: error.message,
                    };
                }
                else {
                    return <ParseResponse>{
                        success: false,
                        error_reason: 'PARSING_FAILURE',
                        message: error,
                    }
                }
            });
    }
}

export default App;