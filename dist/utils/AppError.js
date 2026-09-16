"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, message, code = 'APP_ERROR', details) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
    static badRequest(message, details) {
        return new AppError(400, message, 'BAD_REQUEST', details);
    }
    static unauthorized(message = 'Unauthorized') {
        return new AppError(401, message, 'UNAUTHORIZED');
    }
    static forbidden(message = 'Forbidden') {
        return new AppError(403, message, 'FORBIDDEN');
    }
    static notFound(message = 'Resource not found') {
        return new AppError(404, message, 'NOT_FOUND');
    }
    static conflict(message, details) {
        return new AppError(409, message, 'CONFLICT', details);
    }
}
exports.AppError = AppError;
//# sourceMappingURL=AppError.js.map