# hampalyzer

The Hampalzyer is a utility to parse Half-Life GoldSrc logs for the purporses of game statistics.  This project was intended to support functional reactive programming (FRP) to generate events of interest, such a frags, deaths, and flag captures.  With FRP, Hampalyzer can generate events that represent complex sequences of events: capturing a coast-to-coast flag capture involves a "flag pickup" event followed by a "flag captured" event, attributed to the same player with no "flag dropped" event in between.

Currently, Hampalyzer reads a log file in (see [Usage](#usage) below), then spits out a HTML-encoded set of files that describes team- and player-specific statistics of a Team Fortress Classic game.

## Usage

The Hampalyzer should have an endpoint to consume a a given Half-Life GoldSource log file, which contains typical events such as frags, spawns, and players' interactions with in-game entities. From this file, the Hampalyzer will generate player-centric events that describe in-game performance, and also generate some metadata about the match (which players are on which team, the final score of the match, what map was played, length of match, etc.).

The output will be dumped in /parsedlogs, the library will print the output directory.  To view the logs, point a webserver at that root: `cd parsedlogs; npm i -g http-server; http-server`

You have two options to parse log files:

### Define static log file locations

You can update the log file names in index.ts, recompile, and execute the library.  Gwoss.

### Use as a web endpoint

When the server is running, you can POST two log files to the "/parseGame" route under the "logs" parameter.  Express will respond with a success with a parsed URL, or display an error message if parsing failed.

```
curl -X POST -F 'logs[]=@logs/L0526012.log' -F 'logs[]=@logs/L0526013.log' http://127.0.0.1:3000/parseGame
```

### Immediate to-do:

- [ ] Sort summary view by # kills (or some other score metric)
- [ ] Make distribution portable; copy template files to dist/ directory
- [ ] Implement outputting events to a database (likely Postgres, but may be Azure-ish)
- [ ] Visualizations

## To-Do

Plan:
- To deploy Hampalyzer as a self-service tool:
    - Set up redirect from hampalyzer.com/logs -> doof VM
    - Set up ngnix to serve stuff for app.hampalyzer.com/ with a simple form submittal (see [this example](https://stackabuse.com/handling-file-uploads-in-node-js-with-expres-and-multer/))
    - Set up ngnix to have a reverse proxy to the hampalyzer library from app.hampalyzer.com/api (see [this example](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-16-04))
    - Set up ngnix to serve files from non-privileged user and in well-known space (e.g., var/www/?):
        - ngnix and node.js process should run in non-privileged context
    - Use [jQuery POST](https://api.jquery.com/jquery.post/) and [this tutorial](https://attacomsian.com/blog/xhr-node-file-upload) to do front-end call

    - [ ] Set up reverse proxy for hampalyzer script and shove under /api/
    - [x] Move "frontend" code to /var/www/app.hampalyzer.com
    - [x] Remove manual file parsing
    - [x] Force uploaded files to be local
    - [x] Force parsedlogs to copy/deploy to /var/www/app.hampalyzer.com/parsedlogs


- [ ] Consider using [node-steam/id](https://github.com/node-steam/id) to parse Steam IDs for player-specific pages.
- [ ] Import bootstrap as [an npm dependency](https://getbootstrap.com/docs/4.4/getting-started/download/#npm) with [webpack](https://getbootstrap.com/docs/4.4/getting-started/webpack/) to write [a custom SCSS theme](https://getbootstrap.com/docs/4.4/getting-started/theming/).


### Known bugs:

- [ ] Handle player disconnects if they are in the middle of carrying flag (flag time / flag status)
- [ ] If a player only plays one of two rounds, player stats doesn't format correctly (e.g., stats show in rd2 even though they only played rd1)
- [ ] Classes may not be assigned correctly, e.g. http://app.hampalyzer.com/parsedlogs/Inhouse-2021-Jun-6-02-22/ (hamp rd2)

## Building / Running

You must install Node.js/npm and TypeScript to build this project.  To install TypeScript: `node i -g typescript`.  To get dependencies, make sure to `npm install`.

You can then watch/build the code using `tsc watch`.  You can then launch the project by typing `node dist/index.js`.  Note that currently you must be in the project root for the source to find template files (that'll be fixed shortly so that the distribution is portable).

In Visual Studio Code, you can hit Ctrl-Shift-B to watch the code, then F5 to execute/debug the parser.

### Notes

The following events are added through an external AMX plugin installed on the local game server where the log is generated.  You may need to install this plugin to get these statistics to populate.
* Airshot events
* Flag thrown events

