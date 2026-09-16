"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const AppError_1 = require("./AppError");
/**
 * Validates request params/query/body against zod schemas.
 * Fails fast with a 400 and clear details — financial endpoints rely on this
 * to reject negative, non-numeric or string-mangled amounts.
 */
function validate(schemas) {
    return (req, _res, next) => {
        try {
            if (schemas.params)
                req.params = schemas.params.parse(req.params);
            if (schemas.query)
                req.query = schemas.query.parse(req.query);
            if (schemas.body)
                req.body = schemas.body.parse(req.body);
            next();
        }
        catch (err) {
            next(AppError_1.AppError.badRequest('Invalid request data', err.issues));
        }
    };
}
//# sourceMappingURL=validate.js.map