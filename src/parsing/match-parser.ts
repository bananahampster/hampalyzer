import { OutputStats, OutputPlayer, ParsingError, TeamComposition, TeamStatsComparison } from '../models/types.js';
import PlayerList from '../models/player-list.js';
import type { Event } from '../models/event.js';
import { setGameAwards } from '../stats/awards.js';
import { generateTeamComposition, generateTeamRoleComparison, playerListToOutput } from '../stats/team-stats.js';
import { RoundParser } from './round-parser.js';

type RoundStats = (OutputStats | undefined)[];
export interface ParsedStats {
    stats: RoundStats;
    rawStats: {
        events: Event[][],
        players: PlayerList[],
    },
    players: TeamComposition<OutputPlayer>;
    parsing_errors: (string[] | undefined)[];
    comparison?: TeamStatsComparison;
    isValid: boolean;
}

export interface ParsedStatsOutput extends Omit<ParsedStats, 'rawStats'> {
    chartMarkup: string;
}

export class Parser {
    private rounds: RoundParser[] = [];

    constructor(...filenames: string[]) {
        // TODO: should probably check if the files exist here
        this.rounds = filenames.map(filename => new RoundParser(filename));
     }

    public get stats(): RoundStats {
        return this.rounds.map(round => round.stats);
    }

    public async parseRounds(skipValidation?: boolean): Promise<ParsedStats> {
        return Promise.all(this.rounds.map(round => round.parseFile()))
            .then(() => {
                // TODO: be smarter about ensuring team composition matches, map matches, etc. between rounds
                const stats = this.rounds.map(round => round.stats);

                const isValid = skipValidation || this.validateGame();

                if (!this.rounds[0]!.playerList) {
                    // The log was bogus or failed to parse. Nothing more we can do.
                    throw new ParsingError({
                        name: 'PARSING_FAILURE',
                        message: 'Player list could not be parsed.'
                    });
                }

                let comparison: TeamStatsComparison | undefined;
                let teamComp: TeamComposition<OutputPlayer> = playerListToOutput(this.rounds[0]!.playerList!);
                if (this.rounds.length === 2) {
                    comparison = generateTeamRoleComparison(stats as [OutputStats, OutputStats]);
                    teamComp = generateTeamComposition(this.rounds) || teamComp;
                }

                // calculate game-wide rankings (like MVP?); this'll side-effect stats
                setGameAwards(teamComp, stats);

                return <ParsedStats> {
                    players: teamComp,
                    rawStats: {
                        events: this.rounds.map(round => round.events),
                        players: this.rounds.map(round => round.playerList),
                    },
                    stats,
                    parsing_errors: stats.map(round => round?.parsing_errors),
                    comparison,
                    isValid,
                };
            });
    }

    private validateGame(): boolean {
        if (this.rounds.length < 1 || this.rounds[0].stats == null || this.rounds[0].playerList == null) 
            throw new ParsingError({
                name: 'MATCH_INVALID',
                message: 'Validation failure: could not find one good round to parse.'
            });

        if (this.rounds.length === 1) 
            return true;

        const firstRound = this.rounds[0].stats;
        let gameTime = firstRound.scoring_activity?.game_time_as_seconds || 0;
        let map = firstRound.map;
        let players = this.rounds[0].playerList.players;

        if (this.rounds.length > 2 || this.rounds[1].stats == null || this.rounds[1].playerList == null) 
            throw new ParsingError({
                name: 'MATCH_INVALID',
                message: 'Validation failure: parsed two rounds but second was not parsed.'
            });

        const secondRound = this.rounds[1].stats;
        if (secondRound.map != map)
            throw new ParsingError({
                name: 'MATCH_INVALID',
                message: 'Validation failure: map does not match between two rounds.'
            });

        // verify at least 50% of players from first round match
        const secondPlayers = this.rounds[1].playerList.players;
        const maxDiff = Math.ceil(players.length / 2);        
        const countDiff = players.reduce((countDiff, player) => {
            if (!secondPlayers.some(secondPlayer => player.matches(secondPlayer)))
                countDiff++;

            return countDiff;
        }, 0);

        if (countDiff > maxDiff)    
            throw new ParsingError({
                name: 'MATCH_INVALID',
                message: `Validation failure: several players from first round not found in second round (found ${countDiff} missing, threshold is ${maxDiff}).`
            });

        return true;
    }
}

export default Parser;
