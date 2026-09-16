"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const env_1 = require("../config/env");
function log(level, message, meta) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error')
        console.error(line, meta !== undefined ? meta : '');
    else if (level === 'warn')
        console.warn(line, meta !== undefined ? meta : '');
    else
        console.log(line, meta !== undefined ? meta : '');
}
exports.logger = {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    /** Disable verbose logging outside development. */
    debug: (message, meta) => {
        if (!env_1.isProd)
            log('info', '[DEBUG] ' + message, meta);
    },
};
//# sourceMappingURL=logger.js.map