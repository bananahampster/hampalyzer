import * as express from 'express';
import cors = require('cors');
import multer = require('multer');

import fileParser from './fileParser';
import { Parser } from './parser';
import path = require('path');

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

    constructor(private webserverRoot = "", private outputRoot = "parsedlogs") {
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

        this.express.use('/', router);
    }

    private parseLogs(filenames: string[]): Promise<string | undefined> {
        let parser = new Parser(...filenames)

        return parser.parseRounds()
            .then(allStats => fileParser(allStats, path.join(this.webserverRoot, this.outputRoot)));
    }
}

export default App;