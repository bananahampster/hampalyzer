import * as express from 'express';

import { Parser } from './parser';
import TemplateUtils from './templateUtils';
import * as Handlebars from 'handlebars';
import { readFile, writeFile } from 'fs';
import multer = require('multer');

// see https://github.com/expressjs/multer
// and https://medium.com/@petehouston/upload-files-with-curl-93064dcccc76
// and ...?
let upload = multer({ dest: 'uploads/' });

class App {
    public express: express.Express;

    constructor() {
        this.express = express(); 
        this.mountRoutes();
    }

    private mountRoutes(): void {
        const router = express.Router();
        router.get('/', (req, res) => {
            res.json({
                message: 'Hello world!',
            });
        });

        router.post('/parseGame', upload.array('logs[]', 2), async (req, res) => {
            if (req?.files['logs']?.length < 2) {
                console.error("expected two files");
            }

            const outputFile = await this.parseLogs([
                req.files[0].path, 
                req.files[1].path]);

            console.log(`parsed logs and output ${outputFile}`);

            res.send(`Wrote logs: ${outputFile}`)
        });

        router.post('/parseLog', upload.single('logs'), async (req, res) => {
            const outputFile = await this.parseLogs([req.file.path]);
            console.log(`parsed logs and output ${outputFile}`);

            res.send(`Wrote logs: ${outputFile}`)
        });

        this.express.use('/', router);
    }

    private parseLogs(filenames: string[]): Promise<string> {
        let parser = new Parser(...filenames)
        
        return parser.parseRounds()
            .then((allStats) => {
                if (allStats) {
                    let templateFile = 'src/html/template-twoRds-stacked.html';
                    let isSummary = allStats.stats.length === 2;
                    if (isSummary)
                        templateFile = 'src/html/template-summary.html';

                    const filename = `parsedlogs/${allStats.stats[0]!.log_name}-${isSummary ? 'summary' : 'stacked'}.html`;

                    readFile(templateFile, 'utf-8', (error, source) => {
                        TemplateUtils.registerHelpers();
                        const template = Handlebars.compile(source);
                        const html = template(allStats);

                        writeFile(filename, html, err => {
                            if (err) console.error(`failed to write output: ${err}`);
                            console.log(`saved file ${filename}`);
                        });
                    });

                    return filename;
                } 
                else {
                    console.error('no stats found to write!');
                    return "";
                }
            });
    }
}

export default new App().express;