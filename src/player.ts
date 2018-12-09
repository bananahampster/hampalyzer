class Player {
    private steamNum: string;
    private names: string[];
    private playerNum: number;

    constructor(steamID: string, name: string, playerID: number) {
        this.steamNum = steamID;
        this.names = [name];
        this.playerNum = playerID;
    }

    public addName(name: string): void {
        if (this.names.indexOf(name) === -1)
            this.names.push(name);
    }

    // return the last name??
    public get name(): string {
        return this.names[this.names.length - 1];
    }

    public get steamID(): string {
        return "STEAM_" + this.steamNum;
    }

    public get playerID(): number { 
        return this.playerNum;
    }

    public toString(): string {
        return this.name;
    }
}

export default Player;