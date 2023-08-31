import { TimeInterval } from "./timeInterval.js";

export class TimeIntervalWithContext<TContext> extends TimeInterval {
    public context: TContext;
    public constructor(startTimeInSeconds: number, endTimeInSeconds: number | undefined, context: TContext) {
        super(startTimeInSeconds, endTimeInSeconds);
        this.context = context;
    }
}