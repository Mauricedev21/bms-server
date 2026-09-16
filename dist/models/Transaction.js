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
exports.Transaction = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const env_1 = require("../config/env");
/**
 * A transaction is a financial event where a barber received money from a
 * customer. The original total, PLUS the automatically calculated manager share
 * (60%) and barber share (40%), are all preserved so historical calculations
 * never change even if business settings change later.
 */
const transactionSchema = new mongoose_1.Schema({
    salon: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Barber', required: true, index: true },
    customerName: { type: String, trim: true, default: '' },
    service: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    totalAmount: { type: Number, required: true, min: 0.01 },
    managerShare: { type: Number, required: true },
    barberShare: { type: Number, required: true },
    managerPercent: { type: Number, required: true, default: env_1.env.MANAGER_SHARE_PERCENT },
    barberPercent: { type: Number, required: true, default: env_1.env.BARBER_SHARE_PERCENT },
    paymentMethod: {
        type: String,
        enum: ['cash', 'mobile_money', 'card', 'bank_transfer', 'other'],
        default: 'cash',
        index: true,
    },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed', index: true },
    recordedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    clientRefId: { type: String, required: true, unique: true },
}, { timestamps: true });
transactionSchema.index({ salon: 1, barber: 1, createdAt: -1 });
transactionSchema.index({ salon: 1, paymentMethod: 1 });
transactionSchema.index({ salon: 1, status: 1, createdAt: -1 });
transactionSchema.index({ salon: 1, createdAt: -1 });
exports.Transaction = mongoose_1.default.model('Transaction', transactionSchema);
//# sourceMappingURL=Transaction.js.map