import Handlebars from 'handlebars';
import { OffenseTeamStats, DefenseTeamStats, OutputPlayer, PlayerOutputStatsRound } from './constants.js';

export default class TemplateUtils {
    public static registerHelpers() {

        // simple math
        Handlebars.registerHelper("math", function(lvalue, operator, rvalue, options) {
            lvalue = parseFloat(lvalue);
            rvalue = parseFloat(rvalue);

            return {
                "+": lvalue + rvalue,
                "-": lvalue - rvalue,
                "*": lvalue * rvalue,
                "/": lvalue / rvalue,
                "%": lvalue % rvalue
            }[operator];
        });

        Handlebars.registerHelper('ifCondition', function(this: unknown, lvalue, operator, rvalue, options) {
            switch (operator) {
                case "==":
                    return (lvalue == rvalue) ? options.fn(this) : options.inverse(this);
                case "!=":
                    return (lvalue != rvalue) ? options.fn(this) : options.inverse(this);
                default:
                    return options.inverse(this);
            }
        });

        Handlebars.registerHelper('ifListNotEmpty', function(this: unknown, givenArray: any[][], options) {
            if (givenArray.length && givenArray.some(item => item.length))
                return options.fn(this);
            else
                return options.inverse(this);
        });

        Handlebars.registerHelper('eachOrderKeys', function(this: unknown, givenArray: Object, orderKeys: string, options) {
            // abort if empty
            if (givenArray == null || Object.keys(givenArray).length === 0)
                return;

            let ret = "";
            const orderKeysList = orderKeys.split(',');
            for (const orderKey of (orderKeysList || [])) {
                if (givenArray[orderKey]) {
                    ret += options.fn(givenArray[orderKey]);
                }
            }
            return ret;
        });

        /** Order players on the scoreboard by kills, descending */
        Handlebars.registerHelper('eachPlayerScoreboard', function(this: unknown, givenArray: PlayerOutputStatsRound[], options) {
            // abort if empty
            if (givenArray == null || givenArray.length === 0)
                return;

            givenArray.sort((a, b) => (b.kills.kill?.value || 0) - (a.kills.kill?.value || 0));

            let ret = "";
            for (const player of givenArray)
                ret += options.fn(player);

            return ret;
        });

        Handlebars.registerHelper('countParsingErrors', function(this: unknown, givenArray: any[][]) {
            if (givenArray.length && givenArray.some(item => item.length)) {
                return givenArray.reduce((acc, round) => acc + (round.length || 0), 0);
            }
        });

        function formatSecondsForDisplay(seconds: number) {
            let isNegative = false;
            if (seconds < 0) {
                isNegative = true;
                seconds = Math.abs(seconds);
            }
            let formatted = Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(seconds * 1000);
            if (isNegative) {
                formatted = '-' + formatted;
            }
            return formatted;
        }
        Handlebars.registerHelper('formatSecondsForDisplay', function(seconds: number) {
            return formatSecondsForDisplay(seconds);
        });

        // dumping json objects
        Handlebars.registerHelper('json', function(context) {
            return JSON.stringify(context);
        });

        // team composition
        Handlebars.registerHelper('playerList', function(this: OutputPlayer[], teamId?: string) {
            const players = this.map(player => {
                return `${player.name}
                <a href="https://tracker.thecatacombs.us/index.php?steamid=${player.steamID}&name=&ip="><i class="fas fa-user-tag"></i></a>`
            }).join(', ');

            return `
                <p>
                    <span class="team-title">Team ${teamId}</span> &mdash;
                    <span class="team-list">${players}</span>
                </p>`;
        });

        // offense summary
        Handlebars.registerHelper('offenseSummary', function(this: OffenseTeamStats, damageStatsExist: boolean, teamId: string, players?: OutputPlayer[]) {
            const isComparison = teamId === 'Comp'; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td class="team">${TemplateUtils.getTeamName(teamId, players)}</td>
                    ${TemplateUtils.getRow(this.frags, isComparison, "kills-total")}
                    ${TemplateUtils.getRow(this.kills, isComparison, "kills")}
                    ${TemplateUtils.getRow(this.team_kills, isComparison, "team-kills")}
                    ${TemplateUtils.getRow(this.conc_kills, isComparison, "conc-kills")}
                    ${TemplateUtils.getRow(this.sg_kills, isComparison, "sentry-kills")}` +
                    (damageStatsExist ? `
                    ${TemplateUtils.getRow(this.damage_enemy, isComparison, "damage-enemy")}
                    ${TemplateUtils.getRow(this.damage_team, isComparison, "damage-team")}` : "") + `
                    ${TemplateUtils.getRow(this.deaths, isComparison, "deaths-total")}
                    ${TemplateUtils.getRow(this.d_enemy, isComparison, "deaths")}
                    ${TemplateUtils.getRow(this.d_self, isComparison, "suicides")}
                    ${TemplateUtils.getRow(this.d_team, isComparison, "team-deaths")}
                    ${TemplateUtils.getRow(this.concs, isComparison, "concs")}
                    ${TemplateUtils.getRow(this.caps, isComparison, "flag-captures")}
                    ${TemplateUtils.getRow(this.touches, isComparison, "flag-touches")}
                    ${TemplateUtils.getRow(this.toss_percent, isComparison, "flag-toss-percentage")}
                    ${TemplateUtils.getRow(formatSecondsForDisplay(this.flag_time_in_seconds), isComparison, "flag-time")}
                </tr>`;
        });

        Handlebars.registerHelper('defenseSummary', function(this: DefenseTeamStats, damageStatsExist: boolean, teamId: string, players?: OutputPlayer[]) {
            const isComparison = teamId === 'Comp'; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td class="team">${TemplateUtils.getTeamName(teamId, players)}</td>
                    ${TemplateUtils.getRow(this.frags, isComparison, "kills-total")}
                    ${TemplateUtils.getRow(this.kills, isComparison, "kills")}
                    ${TemplateUtils.getRow(this.team_kills, isComparison, "team-kills")}
                    ${TemplateUtils.getRow(this.conc_kills, isComparison, "conc-kills")}` +
                    (damageStatsExist ? `
                    ${TemplateUtils.getRow(this.damage_enemy, isComparison, "damage-enemy")}
                    ${TemplateUtils.getRow(this.damage_team, isComparison, "damage-team")}` : "") + `
                    ${TemplateUtils.getRow(this.deaths, isComparison, "deaths-total")}
                    ${TemplateUtils.getRow(this.d_enemy, isComparison, "deaths")}
                    ${TemplateUtils.getRow(this.d_self, isComparison, "suicides")}
                    ${TemplateUtils.getRow(this.d_team, isComparison, "team-deaths")}
                    ${TemplateUtils.getRow(this.airshots, isComparison, "airshots")}
                </tr>`;
        });
    }

    static getTeamName(teamId: string, players?: OutputPlayer[]): string {
        let toReturn = "";
        if (teamId === "Comp")
            return toReturn;

        const hasPlayers = Array.isArray(players);
        if (hasPlayers && players?.length)
            toReturn += `<abbr title="${players.map(player => player.name).join(', ')}">`;

        toReturn += `Team ${teamId}`;

        if (hasPlayers)
            toReturn += `</abbr>`;

        return toReturn;
    }

    static getRow(value: number | string, isComparison: boolean, cssClassName: string | undefined): string {
        const baseClassAttributeValue = cssClassName ? `${cssClassName} ` : "";
        if (!isComparison || value === 0)
            return `<td class="${baseClassAttributeValue}">${value}</td>`;
        if (typeof value === 'number') {
            if (value > 0)
                return `<td class="${baseClassAttributeValue}up icon">${value}</td>`;
            else // if (value < 0)
                return `<td class="${baseClassAttributeValue}down icon">${Math.abs(value)}</td>`;
        } else {
            // if first character is "-", consider it 'negative'
            if (value.charAt(0) === "-")
                return `<td class="${baseClassAttributeValue}down icon">${value.slice(1)}</td>`;
            else if (!isNaN(parseInt(value.charAt(0))))
                return `<td class="${baseClassAttributeValue}up icon">${value}</td>`;
            else
                return `<td class="${baseClassAttributeValue}">${value}</td>`;
        }
    }
}