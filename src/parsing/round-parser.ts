import { EventSubscriberManager } from '../state/event-subscriber-manager.js';
import { FileCompression } from '../fileCompression.js';
import { OutputStats, ParsingError } from '../models/types.js';
import PlayerList from '../models/player-list.js';
import type { Event } from '../models/event.js';
import { generateOutputStats } from '../stats/output-builder.js';
import { getFilteredPlayers } from '../stats/player-filter.js';
import { generatePlayerStats } from '../stats/player-stats.js';
import { RoundState } from '../state/round-state.js';
import { createEventFromLine } from './log-line-parser.js';

export class RoundParser {
    private rawLogData: string = "";
    private roundState = new RoundState();
    private players: PlayerList = new PlayerList();

    private allEvents: string[] = [];
    public events: Event[] = [];

    private summarizedStats: OutputStats | undefined;

    private parsingErrors: string[] = [];

    constructor(private filename: string) {
        // should probably check if the file exists here
    }

    public async parseFile(): Promise<void> {
        this.rawLogData = await FileCompression.getDecompressedContents(this.filename);
        return this.parseData();
    }

    public data(): string {
        return this.rawLogData;
    }

    public get stats(): OutputStats | undefined {
        return this.summarizedStats;
    }

    public get playerList(): PlayerList | undefined {
        return this.players;
    }

    private parseData(): void {
        this.allEvents = this.rawLogData.split("\n");

        this.allEvents.forEach((event, lineNumber) => {
            const newEvent = createEventFromLine(lineNumber + 1, event, this.roundState);
            if (newEvent) {
                if (typeof newEvent === 'string') {
                    this.parsingErrors.push(newEvent);
                }
                else {
                    this.events.push(newEvent);
                }
            }
        });

        // abort early if no events found
        if (this.events.length === 0) {
            throw new ParsingError({
                name: 'PARSING_FAILURE',
                message: 'No events found in given log.',
            });
        }

        // Accumulate state by progressively evaluating events. Multiple phases are supported
        // to enable ordering dependencies between event subscribers.
        const eventSubscriberManager = new EventSubscriberManager(this.roundState.getEventSubscribers(), this.roundState);
        try {
            eventSubscriberManager.handleEvents(this.events);
        }
        catch (error: any) {
            console.error(error.message);

            if (error instanceof ParsingError)
                throw error;
            else
                throw new ParsingError({
                    name: "PARSING_FAILURE",
                    message: error.stack || error.message,
                });
        }


        this.players = getFilteredPlayers(this.roundState);
        const score = this.roundState.score;
        for (const team in this.roundState.players.teams) {
            const teamPlayers = this.players.teams[team];
            if (teamPlayers) {
                const teamScore = score[team];
                console.log(`Team ${team} (score ${teamScore}) has ${teamPlayers.length} players: ${teamPlayers.join(', ')}.`);
            }
        }

        const playerStats = generatePlayerStats(this.events);
        this.summarizedStats = generateOutputStats(this.roundState, this.events, playerStats, this.players, this.filename);
        this.summarizedStats.parsing_errors = this.parsingErrors;
    }
}
