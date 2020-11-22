import * as Handlebars from 'handlebars';
import { OffenseTeamStats, DefenseTeamStats, OutputPlayer } from './constants';
import { isNumber } from 'util';

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
        Handlebars.registerHelper('offsenseSummary', function(this: OffenseTeamStats, teamId: string, players?: OutputPlayer[]) {
            const isComparison = teamId === 'Comp'; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td>${TemplateUtils.getTeamName(teamId, players)}</td>
                    ${TemplateUtils.getRow(this.frags, isComparison)}
                    ${TemplateUtils.getRow(this.kills, isComparison)}
                    ${TemplateUtils.getRow(this.team_kills, isComparison)}
                    ${TemplateUtils.getRow(this.sg_kills, isComparison)}
                    ${TemplateUtils.getRow(this.deaths, isComparison)}
                    ${TemplateUtils.getRow(this.d_enemy, isComparison)}
                    ${TemplateUtils.getRow(this.d_self, isComparison)}
                    ${TemplateUtils.getRow(this.d_team, isComparison)}
                    ${TemplateUtils.getRow(this.concs, isComparison)}
                    ${TemplateUtils.getRow(this.caps, isComparison)}
                    ${TemplateUtils.getRow(this.touches, isComparison)}
                    ${TemplateUtils.getRow(this.toss_percent, isComparison)}
                    ${TemplateUtils.getRow(this.flag_time, isComparison)}
                </tr>`;
        });

        Handlebars.registerHelper('defenseSummary', function(this: DefenseTeamStats, teamId: string, players?: OutputPlayer[]) {
            const isComparison = teamId === 'Comp'; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td>${TemplateUtils.getTeamName(teamId, players)}</td>
                    ${TemplateUtils.getRow(this.frags, isComparison)}
                    ${TemplateUtils.getRow(this.kills, isComparison)}
                    ${TemplateUtils.getRow(this.team_kills, isComparison)}
                    ${TemplateUtils.getRow(this.deaths, isComparison)}
                    ${TemplateUtils.getRow(this.d_enemy, isComparison)}
                    ${TemplateUtils.getRow(this.d_self, isComparison)}
                    ${TemplateUtils.getRow(this.d_team, isComparison)}
                    ${TemplateUtils.getRow(this.airshots, isComparison)}
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

    static getRow(value: number | string, isComparison: boolean): string { 
        if (!isComparison || value === 0)
            return `<td>${value}</td>`;
        if (typeof value === 'number') {
            if (value > 0)
                return `<td class="up icon">${value}</td>`;
            else // if (value < 0)
                return `<td class="down icon">${Math.abs(value)}</td>`;
        } else {
            // if first character is "-", consider it 'negative'
            if (value.charAt(0) === "-")
                return `<td class="down icon">${value.slice(1)}</td>`;
            else if (!isNaN(parseInt(value.charAt(0))))
                return `<td class="up icon">${value}</td>`;
            else
                return `<td>${value}</td>`;
        }
    }
}