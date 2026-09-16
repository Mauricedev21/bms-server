"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oid = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
/** Cast a hex id string to ObjectId for use inside aggregation pipelines. */
const oid = (s) => new mongoose_1.default.Types.ObjectId(s);
exports.oid = oid;
//# sourceMappingURL=oid.js.map