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
exports.Loan = void 0;
const mongoose_1 = __importStar(require("mongoose"));
/**
 * Loan given by the salon/manager to a barber. Loans are kept strictly separate
 * from normal barber 40% earnings unless explicitly included in a calculation
 * (e.g. the wallet module shows both side by side but never merges them
 * silently in the transaction share logic).
 */
const loanSchema = new mongoose_1.Schema({
    salon: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    barber: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Barber', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    outstandingAmount: { type: Number, required: true },
    reason: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'settled'], default: 'active', index: true },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
loanSchema.index({ salon: 1, status: 1, createdAt: -1 });
exports.Loan = mongoose_1.default.model('Loan', loanSchema);
//# sourceMappingURL=Loan.js.map