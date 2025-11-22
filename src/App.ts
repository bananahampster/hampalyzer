import dotenv from 'dotenv';
import url from 'url';
import cors from 'cors';
import express from 'express';
import { engine } from 'express-handlebars';
import Handlebars from 'handlebars';
import multer from 'multer';
import tx2 from 'tx2';

import { readFileSync } from 'fs';
import path from 'path';

import { FileCompression } from './fileCompression.js';
import { default as fileParser, HampalyzerTemplates } from './fileParser.js';
import { Parser } from './parser.js';
import TemplateUtils from './templateUtils.js';
import { ParseResponse, ParsingError, ParsingOptions, ParsingOptionsReparse } from './constants.js';
import { DB, ReparseType } from './database.js';

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
    private database: DB;
    private templates: HampalyzerTemplates;
    private readonly PAGE_SIZE: number = 20;

    constructor(private webserverRoot = "", private outputRoot = "parsedlogs") {
        this.express = express();

        this.express.engine('handlebars', engine());
        this.express.set('view engine', 'handlebars'); // how `render()` works
        this.express.set('views', './views'); // where templates live (should be copied relative to executed JS)
        this.express.enable('view cache'); // enable view caching (prod only)

        console.warn(`running NODE_ENV: ${process.env.NODE_ENV ?? '(none)'}`);

        this.express.use(express.static('public')); // serve files from `./public` as static files; 
                                                    // deploy script should also copy these files to webserver root

        this.mountRoutes();

        // create database connection pool
        this.database = new DB();

        // initialize the handlebars templates to be used globally
        const templateDir = new URL('./templates/', import.meta.url);
        const templateFile = new URL('./template-summary.html', templateDir);
        const playerTemplate = new URL('./template-summary-player.html', templateDir);

        TemplateUtils.registerHelpers();
        this.templates = {
            summary: Handlebars.compile(readFileSync(templateFile, 'utf-8')),
            player:  Handlebars.compile(readFileSync(playerTemplate, 'utf-8')),
        };

        // RPC command to reparse; i.e.: `pm2 trigger hampalyzer reparseAll`
        tx2.action('reparseAll', () => {
            this.reparseLogsFromSource(ReparseType.ReparseAll);
        });

        tx2.action('reparseNew', () => {
            this.reparseLogsFromSource(ReparseType.ReparseNew);
        });
    }

    public async reparseLogsFromSource(reparseType?: ReparseType): Promise<void> {
        const success = await this.reparseLogs(reparseType);
        if (!success && reparseType !== ReparseType.ReparseNew) {
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
            let page_num = +req.params['page_num'] || 1;
            
            if (isNaN(page_num)) 
                page_num = 1;

            await this.attemptDatabaseResponse(
                res,
                this.database.getLogs(page_num),
            );
        });

        router.get('/stats/:stat_type', async (req, res) => {
            const { stat_type } = req.params;
            switch (stat_type) {
                case 'numGames': {
                    return await this.attemptDatabaseResponse(
                        res,
                        this.database.getNumGames()
                    );
                }
                case 'maps': {
                    return await this.attemptDatabaseResponse(
                        res,
                        this.database.getMostPlayedMaps(req.query)
                    );
                }
                default: 
                    res.status(404).json({ error: "Unknown stat type." });
                    return;
            }
        });

        // TEST WITH <http://127.0.0.1:3000/parsedlogs/Inhouse-2023-Dec-19-22-57/>
        router.get('/parsedlogs/:log_name/:player_id?', async (req, res) => {
            this.cacheSummaryResponse(res);

            let { log_name, player_id } = req.params;
            if (log_name == null) {
                res.status(404).json({ error: "No log name was supplied." });
                return;
            }

            // base url of the game (will leave trailing slash)
            let baseUrl = req.url.replace(/^\/[^\/]*\/([^\/]*)\/?.*/, '/parsedlogs/$1');
            if (baseUrl.charAt(baseUrl.length - 1) != '/')
                baseUrl += '/';

            // was a full game requested?
            if (player_id == null) {
                this.database.getLogJson(log_name)
                    .then((summary) => {
                        if (summary == null) {
                            res.status(404).json({ error: "Supplied log name was not found in the database." });
                        }
                        else {
                            res.render(
                                'game', 
                                { ...summary, baseUrl }
                            );
                        }                        
                    })
                    .catch((e) => res.status(500).json({ error: `Server had an internal error: ${e.name}.` }));
            }
            else {
                player_id = player_id.replace('.html', '');
                this.database.getLogPlayerJson(log_name, player_id.slice(1))
                    .then((response) => {
                        if (response == null) {
                            res.status(404).json({ error: 'Supplied player id/game was not found in the database' });
                        }
                        else {
                            const { stats, parsing_errors } = response.game;
                            res.render(
                                'player', 
                                { stats, parsing_errors, ...response.player, baseUrl }
                            );
                        }        
                    })
                    .catch((e) => res.status(500).json({ error: `Server had an internal error: ${e.name}.` }));
            }
        });

        this.express.use('/', router);
    }

    /** 
     * Attempts to re-parse all the successfully-parsed logs present in the database.
     * Succeeds if there are no errors, and if the source log files are missing, skips them.
     * Fails if any previous log fails to parse.
     **/
    private async reparseLogs(reparseType?: ReparseType): Promise<boolean> {
        const logs = await this.database.getReparseLogs(reparseType); 
        for (let i = 0, len = logs.length; i < len; i++) {
            const game = logs[i];

            const filenames: string[] = [];
            filenames.push(game.log_file1);
            if (game.log_file2 != null && game.log_file2 != "") {
                filenames.push(game.log_file2);
            }

            console.warn(`${i+1} / ${len} (${Math.round((i+1) / len * 1000) / 10}%) reparsing: ${filenames.join(" + ")}`);

            const parsedLog = await this.parseLogs(filenames, { logId: game.id, skipValidation: false });
            if (!parsedLog.success) {
                // if it is a validation failure, mark it and move on to the next log.
                if (parsedLog.error_reason === 'MATCH_INVALID') {
                    console.error(`LOG ${game.id} invalid: ${parsedLog.message}`);

                    // fire and forget
                    this.database.updateLogInvalid(game.id);
                    continue;
                }
                else {
                    console.error(`failed to parse logs ${filenames.join(" + ")}; aborting`);
                    throw new ParsingError({
                        name: 'PARSING_FAILURE',
                        message: `Failed to reparse.\nReason: ${parsedLog.error_reason}\nMessage: ${parsedLog.message}`,
                    });
                }
            }
        }

        // at least some logs must have been reparsed
        return logs && logs.length !== 0;
    }

    private async parseLogs(filenames: string[], options: ParsingOptions): Promise<ParseResponse> {
        const { skipValidation } = options;
        const logId: number | undefined = (options as ParsingOptionsReparse).logId;

        filenames = await FileCompression.ensureFilesCompressed(filenames, /*deleteOriginals=*/true);
        const parser = new Parser(...filenames);

        return parser.parseRounds(skipValidation)
            .then(allStats => 
                fileParser(
                    allStats, 
                    path.join(this.webserverRoot, this.outputRoot),
                    this.templates, 
                    this.database, 
                    logId
                )
            )
            .catch(error => {
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

    private async attemptDatabaseResponse(
        res: express.Response, 
        callback: Promise<unknown>): Promise<void> 
    {
        await callback
            .then((results) => res.status(200).json(results))
            .catch((e: ParsingError) => {
                if (e.name)
                    res.status(500).json({ error: `${e.name}: ${e.message}`});
                else
                    res.status(500).json({ error: e });
            });
    }

    private cacheSummaryResponse(res: express.Response): void {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}

export default App;