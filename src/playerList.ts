import Player from './player';
import { TeamColor } from './constants';

class PlayerList {
    private _players: Player[];
    private teams: { [team in TeamColor]?: Player[]; };
    // private teams: TeamComposition;

    constructor() {
        this._players = [];
        this.teams = {};
    }

    public getPlayer(steamID: string, name?: string, playerID?: number): Player | undefined {
        const playerIndex = this.playerExistsAtIndex(steamID);
        if (playerIndex !== -1)
            return this._players[playerIndex];

        if (name && playerID) {
            const newPlayer = new Player(steamID, name!, playerID!);
            this._players.push(newPlayer);
            return newPlayer;
        }
    }

    public getPlayerNum(player: Player): number {
        const playerIndex = this.playerExistsAtIndex(player.steamID);
        
        if (playerIndex === -1) {
            this._players.push(player);
            return this._players.length - 1;
        } else {
            return playerIndex;
        }
    }

    // TODO: set players' teams
    private playerExistsAtIndex(steamID: string): number { 
        if (!steamID.startsWith("STEAM"))
            steamID = "STEAM_" + steamID;
            
        let foundIndex = -1;
        this._players.some((curPlayer, i) => {
            if (curPlayer.steamID === steamID) {
                foundIndex = i;
                return true;
            }

            return false;
        });

        return foundIndex;
    }

    public get players(): Player[] {
        return this._players;
    }
}

export default PlayerList;