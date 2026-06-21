# hampalyzer

The Hampalzyer is a utility to parse Half-Life GoldSrc logs for the purporses of game statistics.  This project was intended to support functional reactive programming (FRP) to generate events of interest, such a frags, deaths, and flag captures.  With FRP, Hampalyzer can generate events that represent complex sequences of events: capturing a coast-to-coast flag capture involves a "flag pickup" event followed by a "flag captured" event, attributed to the same player with no "flag dropped" event in between.

Currently, Hampalyzer reads a log file in (see [Usage](#usage) below), then generates a JSON summary of the match + player performance to be dumped into a database.  The server supports rendering those summaries from the database into a viewable form using the `/parsedlog/` endpoint using the `handlebars-express` package.

## Usage

The Hampalyzer should have an endpoint to consume a a given Half-Life GoldSource log file, which contains typical events such as frags, spawns, and players' interactions with in-game entities. From this file, the Hampalyzer will generate player-centric events that describe in-game performance, and also generate some metadata about the match (which players are on which team, the final score of the match, what map was played, length of match, etc.).

You have two options to parse log files:

### Define static log file locations

You can update the log file names in index.ts, recompile, and execute the library.  Gwoss.

### Use as a web endpoint

When the server is running, you can POST two log files to the "/parseGame" route under the "logs" parameter.  Express will respond with a success with a parsed URL, or display an error message if parsing failed.

```
curl -L -X POST -F 'logs[]=@logs/L0526012.log' -F 'logs[]=@logs/L0526013.log' http://127.0.0.1:3000/parseGame
```

If the log fails validation, you can add a "force" form body parameter with any non-null value (e.g., "on") to force-parse the log files anyway.

```
curl -L -X POST -F force=on -F 'logs[]=@logs/L0526012.log' -F 'logs[]=@logs/L0526013.log' http://127.0.0.1:3000/parseGame
```

The server will respond with two kinds of messages:

#### Success

The top-level property `success` will be returned on a successful parse.

```json
{ 
    "success": { 
        "path": "https://app.hampalyzer.com/parsedlogs/fun-2025-Dec-28-15-39/" 
    } 
}
```

#### Failure

The top-level property `failure` will be returned on a failed parse.  The `error_reason` is one of the following (see `ParsingErrorName` type):

* **MATCH_INVALID**: the match failed basic validation: map names should match between logs, match lengths are within 600 seconds of each other, and player pools are at least 50% match between the two rounds.  Pass `force=on` to skip validation.
* **PARSING_FAILURE**: an assertion during file parsing failed, preventing successful completion.  This is usually because there's a map-specific event that failed, open an issue with your log file (with your RCON redacted 🙂).  This can also happen if the log file isn't found to match the GoldSrc specification.
* **DATABASE_FAILURE**: a database failure prevented logging the match.  Usually this is because the DB is unreachable, but it could also be the result of a bug.  The `message` should have more details.  Open an issue or contact @Hampster on Discord.
* **LOGIC_FAILURE**: a logical failure occured; these are almost always bugs.  We make assumptions about how events are logged, specifically for TFC.  If these are violated, then this error is thrown.  Open an issue with your logs.

```json
{ 
    "failure": { 
        "error_reason": "...",
        "message": "..."
    }
}
```

## To-Do

See [the root of production Hampalyzer to see the current to-do list](http://app.hampalyzer.com).

Other things to cosider:
- [ ] Use [node-steam/id](https://github.com/node-steam/id) to parse Steam IDs for player-specific pages instead of relying on some weird string.
- [ ] Import bootstrap as [an npm dependency](https://getbootstrap.com/docs/4.4/getting-started/download/#npm) with [webpack](https://getbootstrap.com/docs/4.4/getting-started/webpack/) to write [a custom SCSS theme](https://getbootstrap.com/docs/4.4/getting-started/theming/).


### Known bugs:

* [ ] Handle player disconnects if they are in the middle of carrying flag (flag time / flag status)
* [ ] If a player only plays one of two rounds, player stats doesn't format correctly (e.g., stats show in rd2 even though they only played rd1)
* [ ] Fix bug that prevents flag returns due to timeout not showing
* [ ] Fix bug for parsing Copper (#59)
* [ ] Fix bug for parsing Baconbowl (#48)

## Building / Running

You must install Node.js/npm and TypeScript to build this project.  To install TypeScript: `node i -g typescript`.  To get dependencies, make sure to `npm install`.  You can then watch/build the code using `tsc --watch`.

You should have Postgres installed and running on your system (DB template coming when someone asks for it).  Supply the database name/password via environment variables `HAMPALYZER_DB_USER` and `HAMPALYZER_DB_PASSWORD`.

Execute the server (without reparse) via `node dist/index.js server parsedlogs /path/to/hampalyzer-www --skipReparse`.

"Reparsing" means re-analyzing all logs from source; this takes at least five seconds per game and takes hours to days to reparse production data.  In the fourth parameter, there are four options for this setting when the server runs (see `getReparseLogs()`):

* _no parameter_: only parse those matches that have no summary in the database (useful if loading from backup).
* `--reparse`: truncate game/player summaries and re-generate all summaries from source log files.  WARNING: If the source log files are not found, _then data loss will occur_.
* `--reparseCheck`: intended to be executed once validation methods have been changed.  Analyzes metadata and summaries to determine if every existing match should be marked as valid or not.  **UNIMPLEMENTED**
* `--skipReparse`: don't do anything with existing logs (e.g., a frontend change has been made that doesn't affect existing matches)

Hampalyzer is intended to run daemonized (e.g. `pm2`) under a static proxy through `nginx`.  Therefore, [the current Hampalyzer](http://app.hampalyzer.com) has a block in its server definition to route API calls to the Hampalyzer instance, and to move static files in `public/` to the webserver root ([see deploy script](./.github/workflows/deploy.yml)):

```
  location /api {
    client_max_body_size 3M;

    rewrite ^/api/(.*)$ /$1 break;

    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
```

To make development easier, in development mode only (`NODE_ENV` is blank), the route `/api` will redirect to `/`, negating the need to set up nginx and its config locally.

### Notes

The following events are added through an external AMX plugin installed on the local game server where the log is generated.  You may need to install this plugin to get these statistics to populate.
* Airshot events
* Flag thrown events

