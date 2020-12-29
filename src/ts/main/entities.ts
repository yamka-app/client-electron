import DataTypes   from "./dataTypes";
import * as fields from "./simpleFields";

// ============================================== ENTITIES
// Entities represent objects in Order. There are multiple
//  entitiy types: users, groups, channels, etc.
// Entities have fields, most notably, IDs.
export class EntityDecodeResult {
    entity: Entity;
    posAfter: number;
}
export class Entity {
    simpleFieldList?: fields.SimpleField[];

    encodeFields?: ()                                        => Buffer;
    decodeFields?: (b: Buffer, limit?: number, pos?: number) => void|number;

    constructor() {
        if(!fields.checkBinaryIdExistence(this.simpleFieldList))
            throw new Error("Entity fields should be id-prefixed");

        this.encodeFields = fields.simpleFieldEncoder(this, this.simpleFieldList);
        this.decodeFields = fields.simpleFieldDecoder(this, this.simpleFieldList);
    }

    encode: () => Buffer = function() {
        if(this.encodePayload === undefined)
            throw new Error("Can't encode a generic entity");

        return this.encodePayload();
    }

    static decode(buf: Buffer, pos: number): EntityDecodeResult {
        const type = DataTypes.decNum(buf.slice(pos, pos + 2));
        var entity: Entity = [
            undefined,
            new User(),
            new Channel(),
            new Group(),
            new Message(),
            new Role()
        ][type];
        entity = {...entity}; // clone the object
        var posAfter = entity.decodeFields(buf, undefined, pos + 2) as number;
        return { entity: entity, posAfter: posAfter };
    }
}

export class User extends Entity {
    typeNum = 1;
    simpleFieldList = [
        new fields.NumField    ("id", 8,         0),
        new fields.StrField    ("email",         1),
        new fields.StrField    ("name",          2),
        new fields.NumField    ("tag", 4,        3),
        new fields.NumField    ("status", 1,     4),
        new fields.StrField    ("statusText",    5),
        new fields.NumField    ("avaFile", 8,    7),
        new fields.NumField    ("mfaEnabled", 1, 8),
        new fields.NumListField("friends", 8,    9),
        new fields.NumListField("blocked", 8,    10),
        new fields.NumListField("pendingIn", 8,  11),
        new fields.NumListField("pendingOut", 8, 12),
        new fields.NumListField("channels", 8,   13),
        new fields.NumListField("groups", 8,     14),
        new fields.NumListField("roles", 8,      15),
        new fields.ColorField  ("color",         16),
        new fields.NumListField("badges", 2,     17),
        new fields.NumField    ("botOwner", 8,   18),
        new fields.NumListField("ownedBots", 8,  19)
    ];
}

export class Channel extends Entity {
    typeNum = 2
    simpleFieldList = [
        new fields.NumField    ("id", 8,       0),
        new fields.StrField    ("name",        1),
        new fields.NumListField("members", 8,  2),
        new fields.NumField    ("group", 8,    3),
        new fields.NumListField("messages", 8, 4),
        new fields.NumListField("typing", 8,   5),
        new fields.NumListField("rules", 1,    6)
    ];
}

export class Group extends Entity {
    typeNum = 2
    simpleFieldList = [
        new fields.NumField    ("id", 8,           0),
        new fields.StrField    ("name",            1),
        new fields.NumListField("channels", 8,     2),
        new fields.NumField    ("owner", 8,        3),
        new fields.NumListField("roles", 8,        4),
        new fields.NumField    ("icon", 8,         5),
        new fields.StrListField("invites",         6),
        new fields.NumField    ("everyoneRole", 8, 7)
    ];
}

export class Message extends Entity {
    typeNum = 4
    simpleFieldList = [
        new fields.NumField        ("id", 8,      0),
        new fields.MsgSectionsField("sections",   1),
        new fields.NumField        ("channel", 8, 2),
        new fields.NumField        ("edited", 1,  3),
        new fields.NumField        ("sender", 8,  4)
    ];
}

export class Role extends Entity {
    typeNum = 5
    simpleFieldList = [
        new fields.NumField    ("id", 8,       0),
        new fields.StrField    ("name",        1),
        new fields.ColorField  ("color",       2),
        new fields.NumField    ("group", 8,    3),
        new fields.NumField    ("priority", 2, 4),
        new fields.PermsField  ("perms",       5),
        new fields.NumListField("members", 8,  6)
    ];
}

export class File extends Entity {
    typeNum = 6
    simpleFieldList = [
        new fields.NumField    ("id", 8,       0),
        new fields.StrField    ("name",        1),
        new fields.StrField    ("size",        2),
        new fields.StrField    ("preview",     3),
        new fields.NumField    ("length", 4,   4),
    ];
}