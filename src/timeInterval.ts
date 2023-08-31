export class TimeInterval {
    startTimeInSeconds: number;
    endTimeInSeconds: number | undefined;

    public constructor(startTimeInSeconds: number, endTimeInSeconds: number | undefined) {
        this.startTimeInSeconds = startTimeInSeconds;
        this.endTimeInSeconds = endTimeInSeconds;
    }
    public setEndTime(endTimeInSeconds: number) {
        this.endTimeInSeconds = endTimeInSeconds;
    }
    public getDuration() : number | undefined {
        if (!this.endTimeInSeconds) {
            return undefined;
        }
        return this.endTimeInSeconds - this.startTimeInSeconds;
    }
    public getClampedDuration(startClampTime: number, endClampTime: number): number | undefined {
        // If endTimeInSeconds is past the end game time _or_ no end time was observed, use the end clamp time.
        return ((!this.endTimeInSeconds || this.endTimeInSeconds > endClampTime) ? endClampTime: this.endTimeInSeconds )
                - (this.startTimeInSeconds > startClampTime ? this.startTimeInSeconds : startClampTime);
    }
};
