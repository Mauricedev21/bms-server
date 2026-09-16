import { z } from 'zod';

const phoneRegex = /^(\+?[0-9]{9,15})$/;

export const registerSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(40),
  fullName: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().regex(phoneRegex, 'A valid phone number is required (e.g. +2507xxxxxxxx)'),
  email: z.string().trim().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  passwordConfirmation: z.string(),
  salonName: z.string().trim().min(2, 'Salon name is required').max(120),
}).refine((d) => d.password === d.passwordConfirmation, {
  message: 'Passwords do not match',
  path: ['passwordConfirmation'],
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  phone: z.string().trim().regex(phoneRegex).optional(),
  email: z.string().trim().email().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const salonUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal('')).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  website: z.string().trim().max(160).optional(),
});

export const barberCreateSchema = z.object({
  name: z.string().trim().min(2, 'Barber name is required').max(120),
  phone: z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
  email: z.string().trim().email().optional().or(z.literal('')).optional(),
  gender: z.enum(['male', 'female', 'other', '']).optional().default(''),
  role: z.string().trim().max(60).optional().default('Barber'),
  specializations: z.array(z.string().trim().max(60)).max(10).optional().default([]),
});

export const barberUpdateSchema = barberCreateSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export const idParamSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const amountField = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Amount must be a positive number' });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

export const transactionCreateSchema = z.object({
  barber: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Select a valid barber'),
  totalAmount: amountField,
  paymentMethod: z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'other']).default('cash'),
  customerName: z.string().trim().max(120).optional().default(''),
  service: z.string().trim().max(120).optional().default(''),
  description: z.string().trim().max(500).optional().default(''),
  clientRefId: z.string().trim().min(8).max(64),
});

export const transactionQuerySchema = z.object({
  barber: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  paymentMethod: z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'other']).optional(),
  status: z.enum(['completed', 'voided']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const loanCreateSchema = z.object({
  barber: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Select a valid barber'),
  amount: amountField,
  reason: z.string().trim().max(300).optional().default(''),
});

export const repaymentCreateSchema = z.object({
  loan: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  amount: amountField,
  method: z.enum(['cash', 'mobile_money', 'card', 'bank_transfer', 'from_earnings', 'other']).default('cash'),
  remark: z.string().trim().max(300).optional().default(''),
});

export const loanQuerySchema = z.object({
  barber: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  status: z.enum(['active', 'settled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const reportQuerySchema = z.object({
  type: z.enum(['daily', 'weekly', 'monthly', 'six_month', 'annual', 'custom']),
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const adminStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'expired']),
});

export const adminCreateUserSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(40),
  fullName: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
  email: z.string().trim().email('A valid email is required'),
  salonName: z.string().trim().min(2, 'Salon name is required').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  passwordConfirmation: z.string(),
}).refine((d) => d.password === d.passwordConfirmation, {
  message: 'Passwords do not match',
  path: ['passwordConfirmation'],
});

export const barberLoginSchema = z.object({
  phone: z.string().trim().regex(phoneRegex, 'A valid phone number is required'),
  pin: z.string().length(6, 'PIN must be 6 digits'),
});

export const barberPinSchema = z.object({
  pin: z.string().length(6, 'PIN must be 6 digits'),
});