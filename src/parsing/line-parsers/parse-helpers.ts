import { PlayerClass, TeamColor, Weapon } from '../../models/types.js';

// Breaks apart a line on spaces while preserving quoted substrings.
// Quoted substrings are returned without the quotes.
export function explodeLine(line: string): string[] {
    let parts = [] as string[];

    let re = /[^\s"]+|"([^"]*)"/g;
    let match;
    do {
        match = re.exec(line);
        if (match !== null) {
            // If index 1 exists, there was a quoted string; return the capture between the quotes.
            // If it doesn't, the entire match in index 0 contains the unquoted string.
            parts.push(match[1] ? match [1] : match[0]);
        }
    } while (match !== null);

    return parts;
}

export function parseClass(playerClass: string): PlayerClass {
    playerClass = playerClass.trim();

    switch (playerClass) {
        case "Scout":
            return PlayerClass.Scout;
        case "Sniper":
            return PlayerClass.Sniper;
        case "Soldier":
            return PlayerClass.Soldier;
        case "Demoman":
            return PlayerClass.Demoman;
        case "Medic":
            return PlayerClass.Medic;
        case "HWGuy":
            return PlayerClass.HWGuy;
        case "Pyro":
            return PlayerClass.Pyro;
        case "Spy":
            return PlayerClass.Spy;
        case "Engineer":
            return PlayerClass.Engineer;
        case "Civilian":
            return PlayerClass.Civilian;
        case "RandomPC":
            return PlayerClass.Random;
        default:
            throw "undefined player class: " + playerClass;
    }
}

// TODO: should make this try to guess teams; apparently maps like baconbowl can customize these
export function parseTeam(team: string): TeamColor {
    team = team.trim().toLowerCase();

    switch (team) {
        case "":
            return TeamColor.None;
        case "blue":
        case "blue :d?": // destroy_l
        case "dustbowl_team1": // baconbowl
        case "attackers": // attac
        case "#dustbowl_team1": // rasen
        case "goto clan": // osaka
            return TeamColor.Blue;
        case "red":
        case "red :d?": // destroy_l
        case "dustbowl_team2": // baconbowl
        case "defenders": // attac
        case "#dustbowl_team2": // rasen
        case "ii clan": // osaka
            return TeamColor.Red;
        case "yellow":
            return TeamColor.Yellow;
        case "green":
            return TeamColor.Green;
        case "spectator":
            return TeamColor.Spectator;
        default:
            break;
    }

    // try to determine color based on inclusion of color string
    if (team.indexOf('blue') > -1)
        return TeamColor.Blue;
    if (team.indexOf('red') > -1)
        return TeamColor.Red;
    if (team.indexOf('yellow') > -1)
        return TeamColor.Yellow;
    if (team.indexOf('green') > -1)
        return TeamColor.Green;

    // otherwise, throw
    throw `unknown team: ${team}`;
}

export function parseWeapon(weapon: string): Weapon {
    weapon = weapon.trim();

    // strip the "with" if it preceds the weapon, if it exists
    if (weapon.startsWith("with"))
        weapon = weapon.trim().substr(5);

    // strip any quotes, if they exist
    if (weapon.indexOf("\"") !== -1) {
        weapon = weapon.replace(/"/gi, "");
    }

    switch (weapon) {
        case "normalgrenade":
            return Weapon.NormalGrenade;
        case "nailgrenade":
            return Weapon.NailGrenade;
        case "mirvgrenade":
            return Weapon.MirvGrenade;
        case "supernails":
        case "superng":
            return Weapon.Supernails;
        case "nails":
        case "ng":
            return Weapon.Nails;
        case "crowbar":
        case "axe":
            return Weapon.Crowbar;
        case 'spanner':
            return Weapon.Spanner;
        case 'medikit':
            return Weapon.Medkit;
        case "shotgun":
            return Weapon.Shotgun;
        case "supershotgun":
            return Weapon.SuperShotgun;
        case "rocket":
        case 'rpg':
            return Weapon.Rocket;
        case "ac":
            return Weapon.AutoCannon;
        case "sentrygun":
            return Weapon.SentryGun;
        case "pipebomb":
        case "pl":
            return Weapon.GreenPipe;
        case 'gl_grenade':
        case 'gl':
            return Weapon.BluePipe;
        case "building_dispenser":
        case "dispenser":
            return Weapon.BuildingDispenser;
        case "building_sentrygun":
        case "sentrygun":
        case "sentrygun (world)":
            return Weapon.BuildingSentryGun;
        case "building_teleporter":
        case "teleporter":
            return Weapon.BuildingTeleporter;
        case "Teleporter_Entrance_Finished":
            return Weapon.BuildingTeleporterEntrance;
        case "Teleporter_Exit_Finished":
            return Weapon.BuildingTeleporterExit;
        case "detpack":
            return Weapon.Detpack;
        case "empgrenade":
            return Weapon.EmpGrenade;
        case "railgun":
            return Weapon.Railgun;
        case "flames":
        case "flamethrower": // TODO really?
        case "ic": // TODO should be IC
            return Weapon.Flames;
        case "napalmgrenade":
            return Weapon.NapalmGrenade;
        case "caltrop":
            return Weapon.Caltrop;
        case "gasgrenade":
            return Weapon.GasGrenade;
        case "knife":
            return Weapon.Knife;
        case "tranq":
            return Weapon.Tranquilizer;
        case "headshot":
            return Weapon.Headshot;
        case "sniperrifle":
            return Weapon.SniperRifle;
        case "autorifle":
            return Weapon.AutoRifle;
        case "infection":
            return Weapon.Infection;
        case "door (world)": // TODO: door frag?
        case "door_rotating (world)": // haste_r
            return Weapon.WorldDoor;
        case "the red lift (world)": // openfire
        case "the blue lift (world)": // openfire
            return Weapon.WorldLift;
        case "teledeath": // TODO: is this a spawn telefrag?
        case "teledeath (world)": // TODO: is this a spawn telefrag?
        case "world":
        case "worldspawn":
        case "worldspawn (world)":
        case "miniturret (world)": // TODO: call this out?
        case "timer (world)": // getting killed after round ends (e.g. infection kill after time)
        case "normalgrenade (world)": // getting killed after round ends (e.g. suicide via grenade):
        case "mirvgrenade (world)":
        case "nailgrenade (world)":
        case "env_explosion (world)": // attac
            return Weapon.WorldSpawn;
        case "trigger_hurt":
        case "trigger_hurt (world)": // TODO: this could be a trigger at the bottom of a pit (shutdown) or world (orbit), how can we distinguish with fall damage?
        case "the red team's lasers (world)": // orbit_l3
        case "the blue team's lasers (world)": // orbit_l3
        case "env_beam (world)": // stormz2
        case "rock_laser_kill (world)": // baconbowl
        case "info_tfgoal (world)": // fry_complex
            return Weapon.Lasers;
        case "train":
        case "train (world)":
            return Weapon.Train;
        case "rock_falling_death (world)": // 2mesa3
        case "#rock_falling_death (world)":
            return Weapon.WorldPit;
        case "timer":
            return Weapon.None;
        default:
            throw "unknown weapon: " + weapon;
    }
}
