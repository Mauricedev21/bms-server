"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = notFound;
const AppError_1 = require("../utils/AppError");
function notFound(_req, _res, next) {
    next(AppError_1.AppError.notFound('API endpoint not found'));
}
//# sourceMappingURL=notFound.js.map