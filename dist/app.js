"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const routes_1 = __importDefault(require("./routes"));
const notFound_1 = require("./middleware/notFound");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimiter_1 = require("./middleware/rateLimiter");
const env_1 = require("./config/env");
function createApp() {
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.use((0, helmet_1.default)());
    const allowedOrigins = env_1.env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    app.use((0, cors_1.default)({
        origin(origin, cb) {
            if (!origin || allowedOrigins.includes(origin))
                return cb(null, true);
            return cb(null, false);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use(express_1.default.urlencoded({ extended: false }));
    if (!env_1.isProd)
        app.use((0, morgan_1.default)('dev'));
    app.use(env_1.env.API_PREFIX, rateLimiter_1.apiLimiter, routes_1.default);
    app.use(notFound_1.notFound);
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map