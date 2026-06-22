import EventType from './event-types.js';
import Player from './player.js';
import { MapLocation } from './map-location.js';
import { PlayerClass, TeamColor, Weapon } from './types.js';

export interface EventCreationOptions {
    eventType: EventType;
    rawLine: string;
    lineNumber: number;
    timestamp: Date;
    data?: ExtraData;
    playerFrom?: Player;
    playerFromClass?: PlayerClass;
    playerTo?: Player;
    playerToClass?: PlayerClass;
    withWeapon?: Weapon;
}

export class Event {
    // core required data
    public eventType: EventType;
    public rawLine: string;
    public lineNumber: number;
    public timestamp: Date;

    // filled in by state trackers as required data for further parsing
    public gameTimeAsSeconds: number; // filled in "EarlyFixups" phase
    public whileConced: boolean; // filled in "Main" phase

    public data?: ExtraData;
    public playerFrom?: Player;
    public playerFromClass?: PlayerClass;
    public playerTo?: Player;
    public playerToClass?: PlayerClass;
    public withWeapon?: Weapon;
    public playerFromWasCarryingFlag: boolean;
    public playerToWasCarryingFlag: boolean;

    constructor(options: EventCreationOptions) {
        // required fields
        this.eventType = options.eventType;
        this.rawLine = options.rawLine;
        this.lineNumber = options.lineNumber;
        this.timestamp = options.timestamp;

        // optional fields
        this.data = options.data;
        this.playerFrom = options.playerFrom;
        this.playerFromClass = options.playerFromClass;
        this.playerTo = options.playerTo;
        this.playerToClass = options.playerToClass;
        this.withWeapon = options.withWeapon;

        // these items are filled in later
        this.gameTimeAsSeconds = -1;
        this.whileConced = false;
        this.playerFromWasCarryingFlag = false;
        this.playerToWasCarryingFlag = false;
    }
    public get value(): string {
        return this.data && this.data.value || "(unknown)";
    }

    public get key(): string {
        return this.data && this.data.key || "(unknown)";
    }
}

export interface ExtraData {
    class?: PlayerClass;
    team?: TeamColor;
    building?: Weapon;
    level?: number;
    key?: string;
    value?: string;
    mapLocation?: MapLocation;
}
