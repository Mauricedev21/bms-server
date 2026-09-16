"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.barberPinSchema = exports.barberLoginSchema = exports.adminCreateUserSchema = exports.adminStatusSchema = exports.reportQuerySchema = exports.loanQuerySchema = exports.repaymentCreateSchema = exports.loanCreateSchema = exports.transactionQuerySchema = exports.transactionCreateSchema = exports.amountField = exports.idParamSchema = exports.barberUpdateSchema = exports.barberCreateSchema = exports.salonUpdateSchema = exports.changePasswordSchema = exports.updateProfileSchema = exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
const phoneRegex = /^(\+?[0-9]{9,15})$/;
exports.registerSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3, 'Username must be at least 3 characters').max(40),
    fullName: zod_1.z.string().trim().max(120).optional().default(''),
    phone: zod_1.z.string().trim().regex(phoneRegex, 'A valid phone number is required (e.g. +2507xxxxxxxx)'),
    email: zod_1.z.string().trim().email('A valid email is required'),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters').max(128),
    passwordConfirmation: zod_1.z.string(),
    salonName: zod_1.z.string().trim().min(2, 'Salon name is required').max(120),
}).refine((d) => d.password === d.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
});
exports.loginSchema = zod_1.z.object({
    identifier: zod_1.z.string().trim().min(1),
    password: zod_1.z.string().min(1),
});
exports.updateProfileSchema = zod_1.z.object({
    fullName: zod_1.z.string().trim().max(120).optional(),
    phone: zod_1.z.string().trim().regex(phoneRegex).optional(),
    email: zod_1.z.string().trim().email().optional(),
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1),
    newPassword: zod_1.z.string().min(8, 'New password must be at least 8 characters'),
});
exports.salonUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120).optional(),
    phone: zod_1.z.string().trim().max(30).optional(),
    email: zod_1.z.string().trim().email().optional().or(zod_1.z.literal('')).optional(),
    address: zod_1.z.string().trim().max(200).optional(),
    city: zod_1.z.string().trim().max(100).optional(),
    website: zod_1.z.string().trim().max(160).optional(),
});
exports.barberCreateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Barber name is required').max(120),
    phone: zod_1.z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
    email: zod_1.z.string().trim().email().optional().or(zod_1.z.literal('')).optional(),
    gender: zod_1.z.enum(['male', 'female', 'other', '']).optional().default(''),
    role: zod_1.z.string().trim().max(60).optional().default('Barber'),
    specializations: zod_1.z.array(zod_1.z.string().trim().max(60)).max(10).optional().default([]),
});
exports.barberUpdateSchema = exports.barberCreateSchema.partial().extend({
    status: zod_1.z.enum(['active', 'inactive']).optional(),
});
exports.idParamSchema = zod_1.z.object({ id: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
exports.amountField = zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).transform((v, ctx) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) {
        ctx.addIssue({ code: 'custom', message: 'Amount must be a positive number' });
        return zod_1.z.NEVER;
    }
    return Math.round(n * 100) / 100;
});
exports.transactionCreateSchema = zod_1.z.object({
    barber: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, 'Select a valid barber'),
    totalAmount: exports.amountField,
    paymentMethod: zod_1.z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'other']).default('cash'),
    customerName: zod_1.z.string().trim().max(120).optional().default(''),
    service: zod_1.z.string().trim().max(120).optional().default(''),
    description: zod_1.z.string().trim().max(500).optional().default(''),
    clientRefId: zod_1.z.string().trim().min(8).max(64),
});
exports.transactionQuerySchema = zod_1.z.object({
    barber: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    paymentMethod: zod_1.z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'other']).optional(),
    status: zod_1.z.enum(['completed', 'voided']).optional(),
    startDate: zod_1.z.string().optional(),
    endDate: zod_1.z.string().optional(),
    search: zod_1.z.string().trim().max(120).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(200).default(20),
});
exports.loanCreateSchema = zod_1.z.object({
    barber: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, 'Select a valid barber'),
    amount: exports.amountField,
    reason: zod_1.z.string().trim().max(300).optional().default(''),
});
exports.repaymentCreateSchema = zod_1.z.object({
    loan: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    amount: exports.amountField,
    method: zod_1.z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'from_earnings', 'other']).default('cash'),
    remark: zod_1.z.string().trim().max(300).optional().default(''),
});
exports.loanQuerySchema = zod_1.z.object({
    barber: zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    status: zod_1.z.enum(['active', 'settled']).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(200).default(20),
});
exports.reportQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['daily', 'weekly', 'monthly', 'six_month', 'annual', 'custom']),
    date: zod_1.z.string().optional(),
    startDate: zod_1.z.string().optional(),
    endDate: zod_1.z.string().optional(),
});
exports.adminStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['active', 'suspended', 'expired']),
});
exports.adminCreateUserSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3, 'Username must be at least 3 characters').max(40),
    fullName: zod_1.z.string().trim().max(120).optional().default(''),
    phone: zod_1.z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
    email: zod_1.z.string().trim().email('A valid email is required'),
    salonName: zod_1.z.string().trim().min(2, 'Salon name is required').max(120),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters').max(128),
    passwordConfirmation: zod_1.z.string(),
}).refine((d) => d.password === d.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
});
exports.barberLoginSchema = zod_1.z.object({
    phone: zod_1.z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
    pin: zod_1.z.string().length(6, 'PIN must be 6 digits'),
});
exports.barberPinSchema = zod_1.z.object({
    pin: zod_1.z.string().length(6, 'PIN must be 6 digits'),
});
//# sourceMappingURL=zodSchemas.js.map