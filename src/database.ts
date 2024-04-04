import pg from 'pg';
import { OutputPlayer, ParsingError, TeamColor, TeamComposition } from './constants.js';
import { Event, ParsedStats } from './parser.js';
import PlayerList from './playerList.js';
import Player from './player.js';
import { TeamScore } from './parserUtils.js';

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
            'SELECT * FROM logs ORDER BY date_parsed DESC LIMIT $1 OFFSET (($2 - 1) * $1)',
            DB.PAGE_SIZE,
            pageNumber
        );
    }

    /** Gets all the logs to reparse on server start */
    public async getReparseLogs(): Promise<ReparseMetadata[]> {
        const logs = await this.query<ReparseMetadata>(
            'SELECT id, log_file1, log_file2 FROM logs WHERE id > 42' // before 42, wrong log filenames
        );

        await this.query('TRUNCATE TABLE match');
        await this.query('TRUNCATE TABLE event RESTART IDENTITY');
        await this.query('TRUNCATE TABLE round RESTART IDENTITY CASCADE');
        // await this.query('TRUNCATE TABLE player RESTART IDENTITY CASCADE'); // no need to truncate this

        return logs;
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

    public async matchTransaction(
        parsedStats: ParsedStats,
        matchMeta: MatchMetadata,
        logId?: number): Promise<boolean> {

        const client = await this.pool.connect();
        const { players, events } = parsedStats.rawStats;

        try {
            await client.query('BEGIN');

            // if we're reparsing, we know this already.
            // otherwise, add and get a logId
            if (logId == null)
                logId = await this.recordLog(matchMeta, client);

            const numRounds = events.length;

            const playerMapping = await this.ensurePlayers(client, players);
            const roundIds = await this.saveRoundTeams(client, parsedStats.players, logId, numRounds, playerMapping);
            await this.saveScore(client, matchMeta.score, logId);
            
            for (let roundNum = 0; roundNum < events.length; roundNum++) {
                const round = events[roundNum];
                const roundId = roundIds[roundNum];

                for (const event of round) {
                    await this.addEvent(client, roundId, event);
                }
            }

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

    private async ensurePlayers(client: pg.PoolClient, playerLists: PlayerList[]): Promise<Record<string, number>> {
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
        const playerToId: Record<string, number> = {};
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
        playerMapping: Record<string, number>): Promise<number[]> {

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
    private addFilters(matchFilters: EventFilters): EventFilterResult {
        matchFilters = { ...DB.defaultFilters, ...matchFilters };
        const keys = Object.keys(matchFilters) as EventFilterTypes[];
        
        let filterString = "";
        let filterParams: any[] = [];
        let paramIndex = 0;

        for (const filter of keys) {
            const filterValue = matchFilters[filter];
            if (filterValue != null) {
                switch (filter) {
                    case 'logValid':
                        filterString += `g.is_valid = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'logMap':
                        filterString += `g.map = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'logMinPlayers':
                        filterString += `g.num_players = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'logServer':
                        filterString += `g.server = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'eventPlayerFrom':
                        filterString += `e.playerFrom = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'eventPlayerTo':
                        filterString += `e.playerTo = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'eventClassFrom':
                        filterString += `e.playerFromClass = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'eventClassTo':
                        filterString += `e.playerToClass = $${paramIndex}`;
                        filterParams[paramIndex++] = filterValue;
                        break;
                    case 'eventAgainstSelf':
                        filterString += 'e.playerTo = e.playerFrom';
                        break;
                    case 'eventPlayerFromBlue':
                        if (filterValue)
                            filterString = '((m2.team = 1 AND e.isFirstLog = true) OR (m2.team = 2 AND e.isFirstLog = false))';
                        else
                            filterString = '((m2.team = 2 AND e.isFirstLog = true) OR (m2.team = 1 AND e.isFirstLog = false))';
                        break;
                    case 'eventPlayerToBlue':
                        if (filterValue)
                            filterString = '((m.team = 1 AND e.isFirstLog = true) OR (m.team = 2 AND e.isFirstLog = false))';
                        else
                            filterString = '((m.team = 2 AND e.isFirstLog = true) OR (m.team = 1 AND e.isFirstLog = false))';
                        break;
                    case 'matchAgainstEnemy':
                        filterString += 'm2.team <> m.team';
                        break;
                    case 'matchAgainstTeammate':
                        filterString += 'm2.team = m.team';
                        break;
                    default:
                        // compiler assertion: all cases handled:
                        const badFilter: never = filter;
                        throw new ParsingError({
                            name: 'LOGIC_FAILURE',
                            message: `unknown filter key/value: ${badFilter} / ${filterValue}`,
                        });                        
                }
                
                filterString += ' ';
            }
        }

        return {
            whereClause: filterString,
            params: filterParams,
        }
    }
}

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