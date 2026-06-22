import PlayerList from "../models/player-list.js";
import Player from "../models/player.js";
import { TeamColor } from "../models/types.js";
import { RoundState } from "../state/round-state.js";

interface PlayerAndTime {
    player: Player;
    time: number;
}

export function getFilteredPlayers(roundState: RoundState): PlayerList {
    const primaryPlayerForSteamID = new Map<string, PlayerAndTime>();
    for (const players of Object.values(roundState.players.teams)) {
        players?.forEach((player: Player) => {
            const playerRoundTime = player.getTotalRoundTimeInSeconds(roundState.roundEndTimeInGameSeconds);
            if (player.team === TeamColor.Spectator || playerRoundTime <= 5) {
                return;
            }

            const existingPlayer = primaryPlayerForSteamID.get(player.steamID);
            if (!existingPlayer || playerRoundTime > existingPlayer.time) {
                primaryPlayerForSteamID.set(player.steamID, { player, time: playerRoundTime });
            }
        });
    }

    const filteredList = new PlayerList();
    for (const [, playerAndTime] of primaryPlayerForSteamID) {
        filteredList.addPlayer(playerAndTime.player);
    }

    return filteredList;
}
