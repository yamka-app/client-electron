import { Entity, Message } from "../protocol/entities.js";

// This is a stipped down (.s) version that just contains definitions the renderer process uses.
// The main one uses regular files

export class SimpleField {
    prop:      string;
    binaryId?: number;
    
    constructor(p: string, bid?: number) { this.prop = p; this.binaryId = bid; }
}