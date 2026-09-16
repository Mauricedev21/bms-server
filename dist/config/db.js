"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.disconnectDB = disconnectDB;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
async function connectDB() {
    mongoose_1.default.set('strictQuery', true);
    try {
        const conn = await mongoose_1.default.connect(env_1.env.MONGODB_URI, {
            serverSelectionTimeoutMS: env_1.isProd ? 15000 : 8000,
        });
        console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    }
    catch (err) {
        console.error('[db] MongoDB connection failed:', err.message);
        throw err;
    }
}
async function disconnectDB() {
    await mongoose_1.default.disconnect();
}
//# sourceMappingURL=db.js.map