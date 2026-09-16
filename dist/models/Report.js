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
exports.Report = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const reportSchema = new mongoose_1.Schema({
    salon: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    reportType: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'six_month', 'annual', 'custom'],
        required: true,
    },
    title: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totals: {
        transactionVolume: { type: Number, default: 0 },
        managerEarnings: { type: Number, default: 0 },
        barberEarnings: { type: Number, default: 0 },
        transactionCount: { type: Number, default: 0 },
        loanRepaymentsReceived: { type: Number, default: 0 },
        outstandingLoans: { type: Number, default: 0 },
    },
    perBarber: [
        {
            barber: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Barber' },
            name: { type: String },
            transactionCount: { type: Number, default: 0 },
            transactionVolume: { type: Number, default: 0 },
            managerShare: { type: Number, default: 0 },
            barberShare: { type: Number, default: 0 },
        },
    ],
    loansIssued: { type: Number, default: 0 },
    loansRepaid: { type: Number, default: 0 },
    generatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    generatedAt: { type: Date, default: Date.now },
    isArchived: { type: Boolean, default: false },
}, { timestamps: true });
reportSchema.index({ salon: 1, reportType: 1, periodStart: -1 });
exports.Report = mongoose_1.default.model('Report', reportSchema);
//# sourceMappingURL=Report.js.map