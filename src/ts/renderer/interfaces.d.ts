import { MessageSectionType } from "../protocol.s/dataTypes.s.js";

declare global {
    interface EditorPollOption {
        id?:    number;
        input?: HTMLInputElement
    }

    interface EditorMessageSection {
        type:       MessageSectionType;
        blob?:      number;
        typeElm:    HTMLElement;
        text?:      string;
        elm:        HTMLElement;
        options?:   EditorPollOption[];
        addOption?: (t?: string) => void;
    }

    var entityCache: any;
    var filePaths: any;
    var userDm: any;
    var msgSections: EditorMessageSection[];

    var viewingGroup: number, viewingChan: number, voiceChan: number, viewingContactGroup: number;
    var previousChannel: number;
    var editingChan: number,  editingRole: number;
    var editingMessage: number;
    var lastChanSender: any, lastChanMsg: any;
    var fetchingMsgs: boolean;

    var packetCallbacks: any;
    var nextCbId: number;
}