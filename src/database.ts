import pg from 'pg';
import { ParsingError } from './constants.js';

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
    public async getLogs(pageNumber = 1): Promise<any[]> {
        return await this.query<any>(
            'SELECT * FROM logs ORDER BY date_parsed DESC LIMIT $1 OFFSET (($2 - 1) * $1)',
            DB.PAGE_SIZE,
            pageNumber
        );
    }

    /** Gets all the logs to reparse on server start */
    public async getReparseLogs(): Promise<ReparseMetadata[]> {
        return await this.query<any>(
            'SELECT id, log_file1, log_file2 FROM logs WHERE id > 42' // before 42, wrong log filenames
        );
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
                message: "Expected one row from DB when querying for duplcates"
            });

        return result[0].cnt !== 0;
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


        if (hasName[0].cnt === 0)
            return parse_name;

        // otherwise, add some junk
        const junk = Math.random().toString(36).substr(2, 5); // 5-char string
        return parse_name + '-' + junk;
    }

    public async recordLog(matchMeta: MatchMetadata): Promise<boolean> {
        const result = await this.query(
            "INSERT INTO logs(parsedlog, log_file1, log_file2, date_parsed, date_match, map, server, num_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            matchMeta.logName,
            matchMeta.logFile_1,
            matchMeta.logFile_2,
            new Date(),
            matchMeta.date_match,
            matchMeta.map,
            matchMeta.server,
            matchMeta.num_players
        );

        return true;
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
}
