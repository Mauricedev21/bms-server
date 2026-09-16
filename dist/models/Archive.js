"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Archive = void 0;
const mongoose_1 = __importStar(require("mongoose"));
/**
 * Archive is the 6-month data-retention store. Before old operational records
 * are cleaned from the live collections, their full payload (including the
 * original transaction amount together with manager/barber shares) is copied
 * here so historical reporting remains possible without risking the current
 * data set.
 */
const archiveSchema = new mongoose_1.Schema({
    kind: { type: String, enum: ['transaction', 'payment', 'loan', 'repayment', 'report'], required: true, index: true },
    originalId: { type: String, required: true },
    salon: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Barber', index: true },
    payload: { type: mongoose_1.Schema.Types.Mixed, required: true },
    archivedAt: { type: Date, default: Date.now, index: true },
    archivedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    sourceDeletedAt: { type: Date },
}, { timestamps: true });
archiveSchema.index({ salon: 1, kind: 1, archivedAt: -1 });
archiveSchema.index({ originalId: 1, kind: 1 }, { unique: true });
exports.Archive = mongoose_1.default.model('Archive', archiveSchema);
//# sourceMappingURL=Archive.js.map