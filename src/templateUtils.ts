import * as Handlebars from 'handlebars';
import { OffenseTeamStats, DefenseTeamStats } from './constants';

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

        // offense summary
        Handlebars.registerHelper('offsenseSummary', function(this: OffenseTeamStats, comparison: boolean) {
            const isComparison = comparison === true; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td>Team A/B</td>
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

        Handlebars.registerHelper('defenseSummary', function(this: DefenseTeamStats, comparison: boolean) {
            const isComparison = comparison === true; // first parameter can sometimes be object??
            return `
                <tr ${isComparison && 'class="comp"'}>
                    <td>Team A/B</td>
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

    static getRow(value: number | string, isComparison: boolean): string { 
        if (!isComparison || value === 0 || typeof value === 'string')
            return `<td>${value}</td>`;
        else if (value > 0)
            return `<td class="up icon">${value}</td>`;
        else // if (value < 0)
            return `<td class="down icon">${Math.abs(value)}</td>`;
    }
}