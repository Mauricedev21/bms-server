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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const env_1 = require("../config/env");
const userSchema = new mongoose_1.Schema({
    username: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    fullName: { type: String, trim: true, default: '' },
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['manager', 'admin'], default: 'manager', index: true },
    status: { type: String, enum: ['active', 'pending', 'suspended', 'expired', 'rejected'], default: 'active', index: true },
    salon: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Salon', index: true },
    requestedSalonName: { type: String, trim: true, default: '' },
    periodDays: { type: Number, default: env_1.env.ACCOUNT_PERIOD_DAYS },
    subscriptionStart: { type: Date },
    subscriptionEnd: { type: Date, index: true },
    lastActiveAt: { type: Date },
}, { timestamps: true });
userSchema.pre('save', async function (next) {
    if (this.isModified('passwordHash')) {
        this.passwordHash = await bcryptjs_1.default.hash(this.passwordHash, env_1.env.BCRYPT_ROUNDS);
    }
    if (this.isNew) {
        this.subscriptionStart = new Date();
        this.subscriptionEnd = new Date(Date.now() + this.periodDays * 24 * 60 * 60 * 1000);
    }
    next();
});
userSchema.methods.comparePassword = function (plain) {
    return bcryptjs_1.default.compare(plain, this.passwordHash);
};
userSchema.methods.subscriptionStatus = function () {
    const now = Date.now();
    const end = this.subscriptionEnd ? this.subscriptionEnd.getTime() : now;
    const daysLeft = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
    const state = now > end ? 'expired' : daysLeft <= env_1.env.NOTIFICATION_EXPIRY_DAYS ? 'expiring' : 'active';
    return { state, daysLeft };
};
exports.User = mongoose_1.default.model('User', userSchema);
//# sourceMappingURL=User.js.map