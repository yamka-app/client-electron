export function logInterp(val: number, vmin: number, vmax: number, outmin: number, outmax: number) {
    const logmin = Math.log(outmin);
    const logmax = Math.log(outmax);

    const scale = (logmax - logmin) / (vmax - vmin);
    return Math.exp(logmin + scale * (val - vmin));
}