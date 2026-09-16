"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const AppError_1 = require("../utils/AppError");
const logger_1 = require("../utils/logger");
const env_1 = require("../config/env");
const errorHandler = (err, req, res, _next) => {
    let statusCode = 500;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details;
    if (err instanceof AppError_1.AppError) {
        statusCode = err.statusCode;
        message = err.message;
        code = err.code;
        details = err.details;
    }
    else if (err instanceof mongoose_1.default.Error.ValidationError) {
        statusCode = 400;
        message = 'Validation failed';
        code = 'VALIDATION_ERROR';
        details = Object.fromEntries(Object.entries(err.errors).map(([k, e]) => [k, e.message]));
    }
    else if (err instanceof mongoose_1.default.Error.CastError) {
        statusCode = 400;
        message = 'Invalid id format';
        code = 'INVALID_ID';
    }
    else if (err.code === 11000) {
        statusCode = 409;
        message = 'Duplicate value — a record with this value already exists';
        code = 'DUPLICATE_KEY';
        const keyValue = err.keyValue;
        if (keyValue)
            details = keyValue;
    }
    else if (err instanceof Error && err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        code = 'INVALID_TOKEN';
    }
    else if (err instanceof Error && err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Session expired, please log in again';
        code = 'TOKEN_EXPIRED';
    }
    if (statusCode >= 500) {
        logger_1.logger.error('[error] ' + (err instanceof Error ? err.stack || err.message : String(err)));
    }
    else {
        logger_1.logger.warn(`[${code}] ${req.method} ${req.originalUrl} — ${message}`);
    }
    res.status(statusCode).json({
        success: false,
        error: {
            code,
            message,
            details: env_1.isProd && statusCode >= 500 ? undefined : details,
        },
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map