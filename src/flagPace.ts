import { color } from 'd3-color';
import * as jsdom from 'jsdom';
import { FlagMovement, ScoringActivity, TeamColor } from './constants.js';

interface ScoreUpdate {
    team: string,
    gameTimeAsSeconds: number,
    currentScore: number,
}
export default class FlagPaceChart {
    data: ScoreUpdate[];

    constructor(roundsScoringActivity: ScoringActivity[])
    {
        this.data = FlagPaceChart.flagCapsToScoreUpdates(roundsScoringActivity);
    }
    
    private static flagCapsToScoreUpdates(roundsScoringActivity: ScoringActivity[]): ScoreUpdate[] {
        let scoreUpdates: ScoreUpdate[] = [];

        roundsScoringActivity.forEach((scoringActivity, roundIndex) => {
            Object.keys(scoringActivity.flag_movements).forEach((team: string, flagMovementIndex) => {
                const teamFlagMovements: FlagMovement[] = scoringActivity.flag_movements[team];
                if (teamFlagMovements) {
                    const teamColor: TeamColor = parseInt(team);
                    const currentTeamLabel = `Round ${roundIndex + 1}: ${TeamColor.toString(teamColor)} team`;
                    if (teamFlagMovements.length > 0) {
                        // Insert a starting entry for time=0s for all teams with at least one cap.
                        scoreUpdates.push({
                            gameTimeAsSeconds: 0,
                            currentScore: 0,
                            team: currentTeamLabel
                        });
                    }
                    teamFlagMovements.forEach(flagMovement => {
                        scoreUpdates.push({
                            gameTimeAsSeconds: flagMovement.game_time_as_seconds,
                            currentScore: flagMovement.current_score,
                            team: currentTeamLabel
                        });
                    });
                    if (teamFlagMovements.length > 0) {
                        // Insert a terminal entry for time=game_time_as_seconds.
                        scoreUpdates.push({
                            gameTimeAsSeconds: scoringActivity.game_time_as_seconds,
                            currentScore: teamFlagMovements[teamFlagMovements.length - 1].current_score,
                            team: currentTeamLabel
                        });
                    }
                }
            });
        });
        return scoreUpdates;
    }
    
    public async getSvgMarkup() {
        // Copyright 2021 Observable, Inc.
        // Released under the ISC license.
        // https://observablehq.com/@d3/multi-line-chart
        // https://observablehq.com/@d3/inline-labels

        const document = new jsdom.JSDOM().window.document;

        const d3 = await import("d3");

        const svgDimensions = { width: 900, height: 600 };
        const margin = { left: 25, right: 25, top: 30, bottom: 30 };

        const yLabel = "Score";
        const colors = ["var(--team-a-color)", "var(--team-b-color)", "var(--team-b-color)", "var(--team-a-color)"];
        const stroke = "currentColor";
        const strokeLinecap = "round";
        const strokeLinejoin = "round";
        const strokeWidth = 5;
        const strokeOpacity = 1;
        const curve = d3.curveStep;
        const mixBlendMode = "lighten";

        const chartDimensions = {
            width: svgDimensions.width - margin.left - margin.right,
            height: svgDimensions.height - margin.bottom - margin.top
        };

        let x = (scoreUpdate: ScoreUpdate) => scoreUpdate.gameTimeAsSeconds;
        let y = (scoreUpdate: ScoreUpdate) => scoreUpdate.currentScore;
        let z = (scoreUpdate: ScoreUpdate) => scoreUpdate.team;

        const X = d3.map(this.data, x);
        const Y = d3.map(this.data, y);
        const Z = d3.map(this.data, z);
        const I = d3.range(this.data.length);
        const defined = (d, i: number) => !isNaN(X[i]) && !isNaN(Y[i]);
        const D = d3.map(this.data, defined);

        const xDomain: any|any = d3.extent(X);
        const xRange = [margin.left, chartDimensions.width - margin.right];
        const yDomain: any|any = [0, d3.max(Y)];
        const yRange = [chartDimensions.height - margin.bottom, margin.top];
        const zDomain = new d3.InternSet(Z);

        const xScale = d3.scaleLinear(xDomain, xRange);
        const yScale = d3.scaleLinear(yDomain, yRange);
        const color = d3.scaleOrdinal(zDomain, colors);
        const xAxis = d3.axisBottom(xScale).ticks(Math.round(this.data[this.data.length - 1].gameTimeAsSeconds / 20))
            .tickFormat((domainValue, index) => {
                if (domainValue.valueOf() % 60 == 0) {
                    return `${domainValue.valueOf() / 60}m`;
                }
                return "";
             });
        const yAxis = d3.axisLeft(yScale).ticks(chartDimensions.height / 60);
        
        const line = d3.line<any>()
            .defined((i) => D[i])
            .curve(curve)
            .x((i) => xScale(X[i]))
            .y(i => yScale(Y[i]));

        const body = d3.select(document).select("body");
        const svg = body.append("svg")
            .attr("width", chartDimensions.width)
            .attr("height", chartDimensions.height)
            .attr("viewBox", `0, 0, ${chartDimensions.width}, ${chartDimensions.height}`)
            .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

        svg.append("g")
            .attr("transform", `translate(0,${chartDimensions.height - margin.bottom})`)
            .call(xAxis);

        svg.append("g")
            .attr("transform", `translate(${margin.left},0)`)
            .call(yAxis)
            .call(g => g.select(".domain").remove())
            .call(g => g.selectAll(".tick line").clone()
                .attr("x2", chartDimensions.width - margin.left - margin.right)
                .attr("stroke-opacity", 0.1))
            .call(g => g.append("text")
                .attr("x", -margin.left)
                .attr("y", 10)
                .attr("fill", "currentColor")
                .attr("text-anchor", "start")
                .text(yLabel));


        const serie = svg.append("g")
            .selectAll("g")
            .data(d3.group(I, i => Z[i]))
            .join("g");

        const path = serie.append("path")
            .attr("fill", "none")
            .attr("stroke", ([key]) => color(key))
            .attr("stroke-width", strokeWidth)
            .attr("stroke-linecap", strokeLinecap)
            .attr("stroke-linejoin", strokeLinejoin)
            .attr("stroke-opacity", strokeOpacity)
            .style("mix-blend-mode", mixBlendMode)
            .attr("d", ([, I]) => line(I));

        return document.body.children[0].outerHTML;
    }

}