# hampalyzer

The Hampalzyer is a utility to parse Half-Life GoldSrc logs for the purporses of game statistics.  This project uses functional reactive programming (FRP) to generate events of interest, such a frags, deaths, and flag captures.  With FRP, Hampalyzer can generate events that represent complex sequences of events: capturing a coast-to-coast flag capture involves a "flag pickup" event followed by a "flag captured" event, attributed to the same player with no "flag dropped" event in between.

This README describes some of the intended utility of this library.

## Usage

The Hampalyzer should have an endpoint to consume a a given Half-Life GoldSource log file, which contains typical events such as frags, spawns, and players' interactions with in-game entities. From this file, the Hampalyzer will generate player-centric events that describe in-game performance, and also generate some metadata about the match (which players are on which team, 
the final score of the match, what map was played, length of match, etc.).

## To-Do

[ ] Consider using [node-steam/id](https://github.com/node-steam/id) to parse Steam IDs for player-specific pages.
[ ] Import bootstrap as [an npm dependency](https://getbootstrap.com/docs/4.4/getting-started/download/#npm) with [webpack](https://getbootstrap.com/docs/4.4/getting-started/webpack/) to write [a custom SCSS theme](https://getbootstrap.com/docs/4.4/getting-started/theming/).

## Building

Execute `npm install` to install the needed attributes.  Run via node: `node dist/index.js`, or debug using VS Code.

### Requested events (we should add through plugin)
* Airshot events
* Flag dropped/thrown events



---

## old data follows (pre-summer 2018)

## Data flow

The data is parsed in three passes:

### Pass 1

The first pass is to obtain metadata about the match that needs to be collected to modify individual statistics.  This pass collects the length of the match (timestamp from first log message to last log message, minus prematch time), the map played, the number of players on the server, the team memberships of each player, etc.  The length of the match will determine the game-relative timestamps used for all events (translates datetime to game time).

### Pass 2

Pass two will collect game statistics concerning each player.

### Pass 3

The third pass will collect all events and construct a flat representation of these events (likely JSON).  The format is anticipated to be something like the following:

```javascript
{
    game: {
        game: "TFC",
        players: [
            { name: "Hampster", id: "STEAM_0:1:206377" },
            ...
        ],
        time: [time_start, time_end],
        matchtime: "15:00",
        matchstart: time_prematch_end,
        teams: [
            { 
                team: "red", 
                number: 4,
                players: [
                    "STEAM_0:1:206377",
                    ...
                ] 
            },
            ...
        ]
    },
    
}
```

## Output format
