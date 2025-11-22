import pg from 'pg';
import { assertNever, OutputPlayer, ParsingError, PlayerOutputStats, PlayerStats, TeamColor, TeamComposition, TeamOutputStatsDetailed } from './constants.js';
import { Event, ParsedStats, ParsedStatsOutput } from './parser.js';
import PlayerList from './playerList.js';
import Player from './player.js';
import { TeamScore } from './parserUtils.js';

/** steamId to DB playerId */
type PlayerMapping = Record<string, number>;

type AllKeys<T> = (keyof T)[] & { length: keyof T extends infer K ? K extends any[] ? K['length'] : never : never };

export class DB {
    private pool: pg.Pool;

    static readonly PAGE_SIZE = 20;

    constructor() {
        this.pool = new pg.Pool({
            user: process.env.HAMPALYZER_DB_USER,
            password: process.env.HAMPALYZER_DB_PASSWORD,
            host: 'localhost',
            database: 'hampalyzer',
            port: 5432,
        });
    }

    /** Helper method for querying the database; will throw DB-specific error if there is a DB issue */
    private async query<T = void>(query: string, ...params: any[]): Promise<T[]> {
        return this.pool.query<any, T[]>(query, params)
            .then(result => result.rows)
            .catch(reason => {
                throw new ParsingError({
                    name: 'DATABASE_FAILURE',
                    message: reason
                });
            });
    }

    /** Gets a list of logs, limited to a 20-log limit */
    public async getLogs(pageNumber = 1): Promise<MatchMetadata[]> {
        return await this.query<MatchMetadata>(
            `SELECT parsedlog, date_parsed, date_match, map, server, num_players, score_team1, score_team2 
               FROM logs 
              ORDER BY date_parsed DESC 
              LIMIT $1 OFFSET (($2 - 1) * $1)`,
            DB.PAGE_SIZE,
            pageNumber
        );
    }

    public async getNumGames(): Promise<number> {
        const result = await this.query<{ count: number }>(`SELECT count(1) as count from logs`);
        
        if (result.length === 1)
            return result[0].count;

        return Infinity;
    }

    public async getMostPlayedMaps(matchFilters?: EventFilters): Promise<{ map: string, count: number }[]> {
        let filterResult = DB.addFilters({ logValid: true }, 2);
        if (matchFilters) {
            filterResult = DB.addFilters(matchFilters, 2);
        }

        return await this.query<{ map: string, count: number }>(
            `SELECT map, count(1) as count 
               FROM logs as g
              WHERE ${filterResult.whereClause} 
              GROUP BY map 
              ORDER BY count DESC
              LIMIT $1;`,
              DB.PAGE_SIZE,
              ...filterResult.params,
        );

// SELECT map, count(1)
//   FROM logs as g
//   JOIN round as r
//     ON r.logid = g.id
//   JOIN match as m
//     ON m.roundid = r.id
//  WHERE m.playerid = 50
//  GROUP BY map 
//  ORDER BY count DESC
//  LIMIT 50;
    }

    public async getLogJson(log_name): Promise<ParsedStatsOutput | undefined> {
        const result = await this.query<{ summary: ParsedStatsOutput } | undefined> (
            `SELECT g.summary 
               FROM logs as l 
               JOIN parsedgames as g
                 ON l.id = g.logId
              WHERE l.parsedlog = $1`,
            log_name
        );

        if (result.length === 1)
            return result[0]!.summary;
    }

    /** @param player_id the `{player_last_sequence_of_steamId}` to match previous URL */
    public async getLogPlayerJson(log_name, player_id): Promise<{ player: PlayerOutputStats; game: ParsedStatsOutput } | undefined> {
        const result = await this.query<{ player: PlayerOutputStats; game: ParsedStatsOutput } | undefined>(
            `SELECT gp.summary as player, g.summary as game
               FROM logs as l
               JOIN parsedgameplayers as gp
                 ON l.id = gp.logId
               JOIN player as p
                 ON p.id = gp.playerId
               JOIN parsedgames as g
                 ON l.id = g.logid
              WHERE l.parsedlog = $1
                AND p.steamid LIKE $2`,
            log_name,
            `%${player_id}`,
        );

        if (result.length === 1)
            return result[0]!;
    }

    /** Gets all the logs to reparse on server start */
    public async getReparseLogs(reparseType: ReparseType = ReparseType.ReparseNew): Promise<ReparseMetadata[]> {
        switch (reparseType) {
            case ReparseType.ReparseNew: {
                const logs = await this.query<ReparseMetadata>(
                    `SELECT id, log_file1, log_file2
                       FROM logs as l
            LEFT OUTER JOIN parsedgames as g
                         ON l.id = g.logid
                      WHERE l.id > 42
                        AND l.is_valid <> FALSE
                        AND g.logid is null
                    `
                );

                console.warn("Reparsing NEW LOGS ONLY.\n\n");

                const logCount = await this.query<{ logcount: number }>(`SELECT count(1) as logcount from logs`);
                const totalLogs = logCount?.[0].logcount;

                console.warn(`Reparsing ${logs.length} logs, ${Math.round(logs.length / totalLogs * 1000) / 10}% of total logs (${totalLogs})`);

                return logs;
            }
            case ReparseType.ReparseAll: {
                const logs = await this.query<ReparseMetadata>(
                    'SELECT id, log_file1, log_file2 FROM logs WHERE id > 42' // before 42, wrong log filenames
                );

                console.warn("Reparsing ALL LOGS FROM SOURCE.  This will take at least 3 full days.\n\nWaiting 60 seconds before continuing.  To stop via daemon: `pm2 stop hampalyzer`");
                await setTimeout(() => {}, 60000);

                await this.query('UPDATE logs SET is_valid = NULL'); // unset determination of invalid logs
                await this.query('TRUNCATE TABLE parsedgames');
                await this.query('TRUNCATE TABLE parsedgameplayers');
                await this.query('TRUNCATE TABLE match');
                await this.query('TRUNCATE TABLE event RESTART IDENTITY');
                await this.query('TRUNCATE TABLE round RESTART IDENTITY CASCADE');
                // await this.query('TRUNCATE TABLE player RESTART IDENTITY CASCADE'); // no need to truncate this

                return logs;
            }
            case ReparseType.CheckAll: {
                throw new Error("Reparse type 'CheckAll' not implemented");
            }
            default:
                assertNever(reparseType);
        }

        return [];
    }

    /** Updates the given log to be invalid */
    public async updateLogInvalid(logId: number): Promise<void[]> {
        return await this.query('UPDATE logs SET is_valid = FALSE WHERE id = $1', logId);
    }

    /** Checks for a duplicate match given logName, map, server, and number of players. */
    public async checkLogDuplicate(matchMeta: MatchMetadata): Promise<boolean> {
        const result = await this.query<{ cnt: number }>(
            "SELECT COUNT(1) as cnt FROM logs WHERE parsedlog = $1 AND map = $2 AND server = $3 AND num_players = $4",
            matchMeta.logName,
            matchMeta.map,
            matchMeta.server,
            matchMeta.num_players
        );

        if (result.length !== 1)
            throw new ParsingError({
                name: 'LOGIC_FAILURE',
                message: "Expected one row from DB when querying for duplicates"
            });

        return result[0].cnt != 0;
    }

    /** Returns a unique log name */
    public async getUniqueLogName(parse_name: string, reparse?: boolean): Promise<string> {
        if (!!reparse) 
            return parse_name;

        const hasName = await this.query<{ cnt: number }>(
            "SELECT COUNT(1) as cnt FROM logs WHERE parsedlog = $1",
            parse_name,
        );

        if (hasName.length !== 1)
            throw new ParsingError({
                name: 'LOGIC_FAILURE',
                message: "Expected one row from DB when querying for unique log name"
            });


        if (hasName[0].cnt == 0)
            return parse_name;

        // otherwise, add some junk
        const junk = Math.random().toString(36).substr(2, 5); // 5-char string
        return parse_name + '-' + junk;
    }

    public async recordLog(matchMeta: MatchMetadata, client?: pg.PoolClient): Promise<number> {
        const query = "INSERT INTO logs(parsedlog, log_file1, log_file2, date_parsed, date_match, map, server, num_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id";

        const params: any[] = [
            matchMeta.logName,
            matchMeta.logFile_1,
            matchMeta.logFile_2,
            new Date(),
            matchMeta.date_match,
            matchMeta.map,
            matchMeta.server,
            matchMeta.num_players
        ];

        let result: number[] | undefined;
        if (client) {
            result = (await client.query(query, params))?.rows;
        }
        else {
            result = await this.query<number>(query, ...params);
        }
        
        if (!result || result.length !== 1)
            throw new ParsingError({
                name: 'LOGIC_FAILURE',
                message: "Expected one row from DB when inserting log metadata"
            });

        return result[0];
    }

    private async recordLogJsons(
        logId: number,
        playerMapping: PlayerMapping,
        parsedStats: ParsedStats,
        chartMarkup: string,
        playerOutputStats: PlayerOutputStats[],
        client: pg.PoolClient): Promise<void> {

        // output players
        for (const playerStats of playerOutputStats) {
            const playerId = playerMapping[playerStats.steamID];
            if (!playerId)
                throw new ParsingError({
                    name: 'LOGIC_FAILURE',
                    message: `failed to find DB playerId of player ${playerStats.steamID}`
                });

            await client.query(
                "INSERT INTO parsedgameplayers(logId, playerId, summary) VALUES ($1, $2, $3)",
                [
                    logId,
                    playerId,
                    playerStats,
                ]
            );
        }

        const summary = DB.cleanUpSummary(parsedStats, chartMarkup);

        await client.query(
            "INSERT INTO parsedgames(logId, summary) VALUES ($1, $2)",
            [logId, summary],
        );
    }

    private static cleanUpSummary(parsedStats: ParsedStats, chartMarkup: string): ParsedStatsOutput {
        // get rid of any remaining event/rawStats info
        const { rawStats: _, ...otherStats } = parsedStats;
        
        // dump all faceted stats details
        const summaryOutput = { ...otherStats, chartMarkup };

        // iterate through known generic stats and remove everything but value
        const playerStatsKeys: (keyof PlayerStats)[] = ['kills', 'buildables', 'damage', 'deaths', 'objectives', 'weaponStats'];

        for (const round of summaryOutput.stats) {
            for (const teamNum in round!.teams) {
                const team = round!.teams[teamNum] as TeamOutputStatsDetailed;
                for (const player of team.players) {
                    for (const statKey of playerStatsKeys) {
                        const playerStat = player[statKey];
                        for (const subStat in playerStat) {
                            let playerSubStat = playerStat[subStat];
                            if (playerSubStat?.value != null) {
                                playerStat[subStat] = { value: playerSubStat.value };
                            }
                        }
                    }
                }
            }
        }

        return summaryOutput;
    }

    public async matchTransaction(
        parsedStats: ParsedStats,
        matchMeta: MatchMetadata,
        playerOutputStats: PlayerOutputStats[],
        chartMarkup: string,
        logId?: number): Promise<boolean> {

        const client = await this.pool.connect();
        const { players, events } = parsedStats.rawStats;

        try {
            await client.query('BEGIN');
           
            const playerMapping = await this.ensurePlayers(client, players);

            // if we're reparsing, we know this already.
            // otherwise, add and get a logId -- and save all info into the DB
            if (logId == null) {
                logId = await this.recordLog(matchMeta, client);
            }

            const numRounds = events.length;

            const roundIds = await this.saveRoundTeams(client, parsedStats.players, logId, numRounds, playerMapping);
            await this.saveScore(client, matchMeta.score, logId);
            
            for (let roundNum = 0; roundNum < events.length; roundNum++) {
                const round = events[roundNum];
                const roundId = roundIds[roundNum];

                for (const event of round) {
                    await this.addEvent(client, roundId, event);
                }
            }

            // save (updated?) summary information into json summary tables
            this.recordLogJsons(logId, playerMapping, parsedStats, chartMarkup, playerOutputStats, client);
            
            await client.query('COMMIT');
        } 
        catch (e: any) {
            await client.query('ROLLBACK');
            throw new ParsingError({
                name: 'DATABASE_FAILURE',
                message: 'Match transaction failure: ' + (e.stack || e.message || e),
            });
        }
        finally {
            client.release();
        }

        return true;
    }

    public async defenseTkDamage(filters: EventFilters = {}): Promise<PlayerDamage[]> {
        const query = `
            SELECT p.alias
                 , COUNT(DISTINCT m.logid) as num_games
                 , SUM((e.extraData::json->>'value')::integer) / COUNT(DISTINCT m.logid) as dmg
              FROM event as e 
              JOIN logs as g
                ON g.id = e.logid
              JOIN match as m
                ON m.logid = e.logid
               AND m.playerid = e.playerTo
              JOIN match as m2
                ON m2.logid = e.logid
               AND m2.playerid = e.playerFrom
              JOIN player as p
                ON p.id = e.playerFrom
             WHERE ((m2.team = 2 AND e.isFirstLog = true) OR (m2.team = 1 AND e.isFirstLog = false))
               AND e.eventType = 64
               AND m2.team = m.team
               AND e.playerFrom <> e.playerTo
               AND g.server = 'Inhouse'
               AND g.num_players >= 8
             GROUP BY e.playerFrom, p.alias
             ORDER BY dmg DESC`;

        return this.query(query)
    }

    private async ensurePlayers(client: pg.PoolClient, playerLists: PlayerList[]): Promise<PlayerMapping> {
        let players: Player[] = [];
        for (const playerList of playerLists)
            players.push(...playerList.players);

        const steamIds = players.map(player => player.steamID);
        const idMapping = await client.query<{ id: number, steamid: string }>(
            `SELECT DISTINCT id, steamid FROM player where steamid = ANY ($1::varchar[])`,
            [steamIds]);

        for (const entry of idMapping.rows) {
            const matchedPlayers = players.filter(player => player.steamID === entry.steamid);

            if (matchedPlayers.length === 0) 
                throw new ParsingError({
                    name: 'LOGIC_FAILURE',
                    message: 'expected to find player we just queried for',
                });

            for (const player of matchedPlayers) 
                player?.updateDbId(entry.id);
        }

        // collect all other players and insert them
        const newUniqSteamIds = [
            ...new Set(
                players
                    .filter(player => player.id == null)
                    .map(player => player.steamID)
            )
        ];
        const newUniqPlayers = newUniqSteamIds.map(steamID => ({ 
            steamID, 
            name: players.find(player => player.steamID == steamID)?.name,
        }));
        
        for (const newPlayer of newUniqPlayers) {
            const newPlayerResult = await client.query<{ id: number }>(
                `INSERT INTO player(name, steamId) VALUES ($1, $2) RETURNING id`,
                [
                    newPlayer.name,
                    newPlayer.steamID,
                ]
            );

            const playerId = newPlayerResult.rows?.[0].id;
            if (playerId == null)
                throw new ParsingError({
                    name: 'LOGIC_FAILURE',
                    message: 'unable to add new player to DB',
                });

            const matchingPlayers = players.filter(player => player.steamID == newPlayer.steamID);
            for (const player of matchingPlayers)
                player.updateDbId(playerId);
        }

        // return steamid to id mapping
        const playerToId: PlayerMapping = {};
        for (const player of players) {
            playerToId[player.steamID] = player.id as number;
        }
        return playerToId;
    }

    private async saveRoundTeams(
        client: pg.PoolClient,
        players: TeamComposition<OutputPlayer>,
        logId: number,
        numRounds: number,
        playerMapping: PlayerMapping): Promise<number[]> {

        const secondRoundOppositeTeam: Record<TeamColor, TeamColor> = {
            0: 0,
            1: 2,  // swap
            2: 1,  // swap
            3: 3,
            4: 4,
            5: 5,
        }
        const roundIds: number[] = [];

        for (let i = 0; i < numRounds; i++) {
            const newRoundResult = await client.query<{ id: number }>(
                `INSERT INTO round(logId, isFirst) VALUES ($1, $2) RETURNING id`,
                [
                    logId,
                    i === 0,
                ]
            );

            const roundId = newRoundResult.rows?.[0].id;
            if (roundId == null) 
                throw new ParsingError({
                    name: "LOGIC_FAILURE",
                    message: 'unable to add new round to DB',
                });

            roundIds.push(roundId);
        }

        for (const team in players) {
            const teamPlayers = players[team] as OutputPlayer[];
            if (teamPlayers != null) {
                for (const player of teamPlayers) {
                    const playerId = playerMapping[player.steamID];

                    await client.query(
                        `INSERT INTO match(roundid, playerid, team) VALUES ($1, $2, $3)`,
                        [
                            roundIds[0],
                            playerId,
                            +team
                        ]
                    );

                    if (roundIds[1] != null) {
                        await client.query(
                            `INSERT INTO match(roundid, playerid, team) VALUES ($1, $2, $3)`,
                            [
                                roundIds[1],
                                playerId,
                                secondRoundOppositeTeam[+team],
                            ]
                        );
                    }
                }
            }
        }

        return roundIds;
    }

    private async saveScore(client: pg.PoolClient, score: TeamScore, logId: number): Promise<void> {
        await client.query(
            `UPDATE logs
                SET score_team1 = $1, score_team2 = $2
              WHERE id = $3`,
            [
                score[1],
                score[2],
                logId,
            ]
        );
    }
    
    private async addEvent(client: pg.PoolClient, roundId: number, event: Event): Promise<void> {
        client.query(
            `INSERT INTO 
                event(roundId, eventType, lineNumber, timestamp, gameTime, extraData, playerFrom, playerFromClass, playerTo, playerToClass, withWeapon, playerFromFlag, playerToFlag) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                roundId,
                event.eventType,
                event.lineNumber,
                event.timestamp,
                event.gameTimeAsSeconds,
                event.data,
                event.playerFrom?.id,
                event.playerFromClass,
                event.playerTo?.id,
                event.playerFromClass,
                event.withWeapon,
                event.playerFromWasCarryingFlag,
                event.playerToWasCarryingFlag,
            ]
        )
    }

    static readonly defaultFilters: EventFilters = {
        logValid: true,
        logMinPlayers: 8,
    };
    
    static addFilters(
        matchFilters: EventFilters, 
        start_param:number = 1): EventFilterResult 
    {
        matchFilters = { ...DB.defaultFilters, ...matchFilters };
        const keys = Object.keys(matchFilters) as EventFilterTypes[];
        
        let filterString: string[] = [];
        let filterParams: any[] = [];
        let paramIndex = start_param;
        let fillIndex = 0;

        for (const filter of keys) {
            const filterValue = matchFilters[filter];
            if (filterValue != null) {
                switch (filter) {
                    case 'logValid':
                        filterString.push(`g.is_valid IS NOT FALSE`);
                        break;
                    case 'logMap':
                        filterString.push(`g.map = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'logMinPlayers':
                        filterString.push(`g.num_players >= $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'logServer':
                        filterString.push(`g.server = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'eventPlayerFrom':
                        filterString.push(`e.playerFrom = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'eventPlayerTo':
                        filterString.push(`e.playerTo = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'eventClassFrom':
                        filterString.push(`e.playerFromClass = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'eventClassTo':
                        filterString.push(`e.playerToClass = $${paramIndex++}`);
                        filterParams[fillIndex++] = filterValue;
                        break;
                    case 'eventAgainstSelf':
                        filterString.push('e.playerTo = e.playerFrom');
                        break;
                    case 'eventPlayerFromBlue':
                        if (filterValue)
                            filterString.push('((m2.team = 1 AND e.isFirstLog = true) OR (m2.team = 2 AND e.isFirstLog = false))');
                        else
                            filterString.push('((m2.team = 2 AND e.isFirstLog = true) OR (m2.team = 1 AND e.isFirstLog = false))');
                        break;
                    case 'eventPlayerToBlue':
                        if (filterValue)
                            filterString.push('((m.team = 1 AND e.isFirstLog = true) OR (m.team = 2 AND e.isFirstLog = false))');
                        else
                            filterString.push('((m.team = 2 AND e.isFirstLog = true) OR (m.team = 1 AND e.isFirstLog = false))');
                        break;
                    case 'matchAgainstEnemy':
                        filterString.push('m2.team <> m.team');
                        break;
                    case 'matchAgainstTeammate':
                        filterString.push('m2.team = m.team');
                        break;
                    default:
                        // compiler assertion: all cases handled:
                        const badFilter: never = filter;
                        throw new ParsingError({
                            name: 'LOGIC_FAILURE',
                            message: `unknown filter key/value: ${badFilter} / ${filterValue}`,
                        });                        
                }
            }
        }

        return {
            whereClause: filterString.join(' AND '),
            params: filterParams,
        }
    }
}

/** Specifies the type of reparsing to do on server start.  If not provided, skip any setup. */
export enum ReparseType {
    /** Only parse logs into the database that don't have an entry in parsedGames */
    ReparseNew = 0,
    /** Truncate event, round tables, and reparse all games  from log sources */
    ReparseAll,
    /** TODO: not implemented; do verification checks on all existing games and reparse if validation fails */
    CheckAll,
};

export interface ReparseMetadata {
    id: number,
    log_file1: string;
    log_file2: string | undefined;
}

export interface MatchMetadata {
    logName: string;
    logFile_1: string;
    logFile_2: string | undefined;
    date_match: Date;
    map: string | undefined;
    server: string | undefined;
    num_players: number | undefined;
    score: TeamScore;
}

export interface PlayerDamage {
    alias: string;
    num_games: number,
    dmg: number,
}

export interface EventFilters {
    logValid?: boolean;
    logMinPlayers?: number;
    logMap?: string;
    logServer?: string;
    eventPlayerFrom?: number;
    eventPlayerTo?: number;
    eventClassFrom?: number;
    eventClassTo?: number;
    eventPlayerFromBlue?: boolean;
    eventPlayerToBlue?: boolean;
    matchAgainstEnemy?: boolean;
    matchAgainstTeammate?: boolean;
    eventAgainstSelf?: boolean;
}
type EventFilterTypes = keyof EventFilters;

export interface EventFilterResult {
    whereClause: string;
    params: any[];
}