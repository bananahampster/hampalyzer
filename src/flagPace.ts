import { color } from 'd3-color';
import * as jsdom from 'jsdom';
import { FlagMovement, FlagMovementFrag, FlagMovementType, ParsingError, ScoringActivity, TeamColor } from './constants.js';

interface FlagUpdate {
    team: string,
    gameTimeAsSeconds: number,
    currentScore: number,
    type: FlagMovementType,
    title: string,
}

interface FlagProgression {
    start: number; // game_time_as_seconds
    end: number;
    type: Omit<FlagMovementType, FlagMovementType.Pickup>;
    title: string;
}

export default class FlagPaceChart {
    data: FlagUpdate[];
    flagProgression: FlagProgression[][][] | undefined;

    constructor(roundsScoringActivity: ScoringActivity[])
    {
        this.data = FlagPaceChart.flagCapsToScoreUpdates(roundsScoringActivity);

        try {
            this.flagProgression = FlagPaceChart.flagUpdatesToProgression(this.data);
        } catch (e) {
            if (e instanceof ParsingError) {
                console.error('failed to parse flag progression; skipping flag progression visualization');
            }
        }
    }

    private static flagCapsToScoreUpdates(roundsScoringActivity: ScoringActivity[]): FlagUpdate[] {
        let flagUpdates: FlagUpdate[] = [];

        roundsScoringActivity.forEach((scoringActivity, roundIndex) => {
            Object.keys(scoringActivity.flag_movements).forEach((team: string, flagMovementIndex) => {
                const teamFlagMovements: FlagMovement[] = scoringActivity.flag_movements[team];
                if (teamFlagMovements) {
                    const teamColor: TeamColor = parseInt(team);
                    const currentTeamLabel = `Round ${roundIndex + 1}: ${TeamColor.toString(teamColor)} team`;
                    if (teamFlagMovements.length > 0) {
                        // Insert a starting entry for time=0s for all teams with at least one cap.
                        flagUpdates.push({
                            gameTimeAsSeconds: 0,
                            currentScore: 0,
                            type: FlagMovementType.Returned,
                            team: currentTeamLabel,
                            title: 'Dropped: start of round',
                        });
                    }
                    teamFlagMovements.forEach(flagMovement => {
                        const timestamp = Intl.DateTimeFormat('en-us', { minute: 'numeric', second: '2-digit' }).format(flagMovement.game_time_as_seconds * 1000);
                        let title = `[${timestamp}] `;
                        const movementType = flagMovement.type;
                        switch (movementType) {
                            case FlagMovementType.Captured:
                                title += `Captured by ${flagMovement.carrier}`;
                                break;
                            case FlagMovementType.Dropped:
                                title += `Dropped by ${flagMovement.carrier}`;
                                break;
                            case FlagMovementType.Fragged:
                                title += `${flagMovement.carrier} fragged by ${(flagMovement as FlagMovementFrag).fragger}`
                                break;
                            case FlagMovementType.Pickup:
                                title += `Grabbed by ${flagMovement.carrier}`;
                                break;
                            case FlagMovementType.Returned:
                                title += `Flag returned`;
                                break;
                            case FlagMovementType.Thrown:
                                title += `Thrown by ${flagMovement.carrier}`;
                                break;
                            default:
                                const type: never = movementType;
                        }

                        flagUpdates.push({
                            gameTimeAsSeconds: flagMovement.game_time_as_seconds,
                            currentScore: flagMovement.current_score,
                            type: flagMovement.type,
                            team: currentTeamLabel,
                            title,
                        });
                    });
                    if (teamFlagMovements.length > 0) {
                        // Insert a terminal entry for time=game_time_as_seconds.
                        flagUpdates.push({
                            gameTimeAsSeconds: scoringActivity.game_time_as_seconds,
                            currentScore: teamFlagMovements.at(-1)!.current_score,
                            type: FlagMovementType.Dropped,
                            team: currentTeamLabel,
                            title: "Dropped: end of round",
                        });
                    }
                }
            });
        });
        return flagUpdates;
    }

    private static flagUpdatesToProgression(flagUpdates: FlagUpdate[]): FlagProgression[][][] {
        let progression: FlagProgression[][][] = [[[]]];
        let teamLabels: Record<string, number> = {};

        let currentProgression: FlagProgression[] = [];
        let currentTeam = -1;
        let currentFlag = 0;
        let activeFlag: FlagProgression | null = null;
        for (const update of flagUpdates) {
            if (teamLabels[update.team] == null) {
                teamLabels[update.team] = ++currentTeam;
                progression[currentTeam] = [[]];
                
                currentFlag = 0;
                currentProgression = progression[currentTeam][currentFlag];
            }
            else if (teamLabels[update.team] !== currentTeam) {
                throw new ParsingError({
                    name: 'LOGIC_FAILURE',
                    message: 'expected that flagUpdates are in order',
                });
            }

            if (activeFlag === null) {
                if (update.type === FlagMovementType.Pickup) {
                    activeFlag = {
                        start: update.gameTimeAsSeconds,
                        title: update.title,
                        end: update.gameTimeAsSeconds, // will be updated
                        type: update.type, // will be updated
                    }
                }
                else if (update.type === FlagMovementType.Returned) {
                    currentProgression.push({
                        start: update.gameTimeAsSeconds,
                        title: update.title,
                        end: update.gameTimeAsSeconds,
                        type: update.type
                    });
                }
                else if (update.type === FlagMovementType.Dropped) {
                    continue; // show nothing; flag wasn't moving anyway (e.g., end of round)
                }
                else {
                    throw new ParsingError({
                        name: 'LOGIC_FAILURE',
                        message: 'expected to see flag pickup/return before subsequent event'
                    });
                }
            }
            else {
                if (update.type === FlagMovementType.Pickup) { // NOTE: if server doesn't log flag throws, assume player had flag up until flag is touched again (not great)
                    activeFlag.end = update.gameTimeAsSeconds
                    activeFlag.type = FlagMovementType.Thrown,
                    activeFlag.title = `Assume thrown`;
                    currentProgression.push(activeFlag);
                    
                    activeFlag = {
                        start: update.gameTimeAsSeconds,
                        end: update.gameTimeAsSeconds,
                        title: update.title,
                        type: update.type
                    };
                }
                else if (update.type !== FlagMovementType.Returned) { 
                    activeFlag.end = update.gameTimeAsSeconds;
                    activeFlag.type = update.type;
                    activeFlag.title = update.title;

                    // add to progression and reset active
                    currentProgression.push(activeFlag);
                    activeFlag = null;

                    if (update.type === FlagMovementType.Captured) {
                        currentProgression = progression[currentTeam][++currentFlag] = [];
                    }
                }
                else {
                    throw new ParsingError({
                        name: 'LOGIC_FAILURE',
                        message: 'expected to see flag drop/throw/frag/capture/pickup after pickup',
                    });
                }
            }
        }

        return progression;
    }

    public async getSvgMarkup(): Promise<string> {
        // Copyright 2021 Observable, Inc.
        // Released under the ISC license.
        // https://observablehq.com/@d3/multi-line-chart
        // https://observablehq.com/@d3/inline-labels

        // hamp: it's possible to not have any flag movements when you get to the point: abort if so
        if (this.data == null || this.data.length === 0)
            return "";

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
        const curve = d3.curveStepAfter;
        const mixBlendMode = "lighten";

        const chartDimensions = {
            width: svgDimensions.width - margin.left - margin.right,
            height: svgDimensions.height - margin.bottom - margin.top
        };

        let x = (scoreUpdate: FlagUpdate) => scoreUpdate.gameTimeAsSeconds;
        let y = (scoreUpdate: FlagUpdate) => scoreUpdate.currentScore;
        let z = (scoreUpdate: FlagUpdate) => scoreUpdate.team;
        let t = (scoreUpdate: FlagUpdate) => scoreUpdate.type;
        let s = (scoreUpdate: FlagUpdate) => scoreUpdate.title;

        const X = d3.map(this.data, x);
        const Y = d3.map(this.data, y);
        const Z = d3.map(this.data, z);
        const T = d3.map(this.data, t);
        const S = d3.map(this.data, s);
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
        const typeColor = d3.scaleOrdinal(
            [0, 1, 2, 3, 4, 5],
            ['var(--flag-pickup)', 'var(--flag-fragged)', 'var(--flag-thrown)', 'var(--flag-dropped)', 'var(--flag-returned)', 'var(--flag-captured)']
        );
        const xAxis = d3.axisBottom(xScale).ticks(Math.round(this.data.at(-1)!.gameTimeAsSeconds / 20))
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

        serie.append("path")
            .attr("fill", "none")
            .attr("stroke", ([key]) => color(key))
            .attr("stroke-width", strokeWidth)
            .attr("stroke-linecap", strokeLinecap)
            .attr("stroke-linejoin", strokeLinejoin)
            .attr("stroke-opacity", strokeOpacity)
            .style("mix-blend-mode", mixBlendMode)
            .attr("d", ([, I]) => line(I));

        // only add flag progression markers/labels if we know that what we have is good
        if (this.flagProgression != null) {
            const jitter = d3.scaleOrdinal([-6, 6]);
            serie.append('g')
                .attr('class', 'markers')
                .attr('transform', ([grp,]) => `translate(0, ${jitter(grp)})`)
                .selectAll('circle')
                .data(function (d) { return d[1].filter(i => T[i] !== 5); })
                .join('circle')
                .attr('class', i => `flag-${T[i]}`)
                .attr('cx', i => xScale(X[i]))
                .attr('cy', i => yScale(Y[i]))
                .attr('r', '4')
                .style('fill', i => typeColor(T[i]))
                .append('title')
                    .text(i => S[i]);

            const that = this;
            serie.each(function (_, teamIndex) {
                const touches = that.flagProgression![teamIndex].map(flag => flag.length);

                d3.select<d3.BaseType, [string, number[]]>(this).append('g')
                    .attr('class', 'touch-labels')
                    .selectAll('text')
                    .data(function(d) { return d[1].filter(i => T[i] === 5); })
                    .join('text')
                    .attr('x', i => xScale(X[i]))
                    .attr('y', i => yScale(Y[i]))
                    .attr('dy', '-0.66em')
                    .text((_,i) => touches[i])
                    .append('title')
                        .text((i, index) => `${S[i]} (${touches[index]} touches)`);
            });
        }

        return document.body.children[0].outerHTML;
    }

}