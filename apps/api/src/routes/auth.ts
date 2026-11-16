import { Router } from 'express';
import { z } from 'zod';
import { authenticateUser, registerUser } from '../db/auth-data.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { createAccessToken, authRoles, currentUser, requireAuth } from '../lib/auth.js';
import { parse } from '../lib/validate.js';

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Password must be no more than 72 bytes');

const registrationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: passwordSchema,
  role: z.enum(authRoles),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must be no more than 72 bytes',
  ),
}).strict();

function isDuplicateEmailError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ER_DUP_ENTRY';
}

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = parse(registrationSchema, req.body);

    let user;
    try {
      user = await registerUser(input.name, input.email, input.password, input.role);
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new HttpError(409, 'An account with this email already exists');
      }
      throw error;
    }

    res.status(201).json({ token: createAccessToken(user), user });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await authenticateUser(input.email, input.password);
    if (!user) {
      throw new HttpError(401, 'Invalid email or password');
    }

    res.json({ token: createAccessToken(user), user });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  (req, res) => {
    res.json(currentUser(req));
  },
);
