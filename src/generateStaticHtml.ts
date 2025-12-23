import fs from 'fs';
import path from 'path';
import url from 'url';
import Handlebars from 'handlebars';

const reqFile = process.argv[2];

console.log(`generating HTML file: ${reqFile}.html`);

const baseUrl = import.meta.url;
const sourcePath = url.fileURLToPath(new URL(`./views/content/${reqFile}.html`, baseUrl));
console.log(`importing from ${sourcePath}`);

const htmlContent = fs.readFileSync(path.resolve(sourcePath), 'utf-8');
let title: string | undefined = undefined;
switch (reqFile) {
    case 'index':
        break; // use just base title
    case 'logs':
        title = "Log index";
        break;
    default:
        break; // use just base title
}

const mainPath = url.fileURLToPath(new URL('./views/layouts/main.handlebars', baseUrl));
const template = fs.readFileSync(path.resolve(mainPath), 'utf-8');
const renderTemplate = Handlebars.compile(template);

const html = renderTemplate({ body: htmlContent, title });

const outputPath = path.resolve(url.fileURLToPath(new URL(`../public/${reqFile}.html`, baseUrl)));
fs.writeFile(
    outputPath,
    html,
    err => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(`wrote static file to ${outputPath}`);
    }
)