export class MapLocation {
    public x: number;
    public y: number;
    public z: number;

    public constructor(x: string, y: string, z: string) {
        this.x = parseFloat(x);
        this.y = parseFloat(y);
        this.z = parseFloat(z);
    }
}
