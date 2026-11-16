import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { findUserById } from '../db/auth-data.js';
import { HttpError } from './errors.js';

export const authRoles = ['caregiver', 'ot', 'sped_teacher'] as const;
export type AuthRole = (typeof authRoles)[number];

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: AuthRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const issuer = 'special-project-api';
const audience = 'special-project-client';
const authRoleSet = new Set<string>(authRoles);

function isAuthRole(role: unknown): role is AuthRole {
  return typeof role === 'string' && authRoleSet.has(role);
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret.length === 0 || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes');
  }
  return secret;
}

export function validateJwtConfiguration(): void {
  getJwtSecret();
}

export function createAccessToken(user: AuthUser): string {
  if (!Number.isSafeInteger(user.id) || user.id < 1) {
    throw new Error('Cannot create an access token for an invalid user id');
  }

  return jwt.sign(
    { name: user.name, email: user.email, role: user.role },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      audience,
      expiresIn: '8h',
      issuer,
      subject: String(user.id),
    },
  );
}

function authUserFromPayload(payload: string | JwtPayload): AuthUser | undefined {
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    return undefined;
  }

  const id = Number(payload.sub);
  const { name, email, role } = payload;
  if (
    !Number.isSafeInteger(id)
    || id < 1
    || typeof payload.exp !== 'number'
    || typeof payload.iat !== 'number'
    || typeof name !== 'string'
    || typeof email !== 'string'
    || !isAuthRole(role)
  ) {
    return undefined;
  }

  return { id, name, email, role };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    throw new HttpError(401, 'Authentication required');
  }

  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token || extra.length > 0) {
    throw new HttpError(401, 'Invalid or expired token');
  }

  let payload: string | JwtPayload;
  try {
    payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      audience,
      issuer,
    });
  } catch (error) {
    if (
      error instanceof Error
      && ['JsonWebTokenError', 'NotBeforeError', 'TokenExpiredError'].includes(error.name)
    ) {
      throw new HttpError(401, 'Invalid or expired token');
    }
    throw error;
  }

  const tokenUser = authUserFromPayload(payload);
  if (!tokenUser) {
    throw new HttpError(401, 'Invalid or expired token');
  }

  if (process.env.NODE_ENV === 'test' && process.env.DB_HOST === undefined) {
    req.user = tokenUser;
  } else {
    const user = await findUserById(tokenUser.id);
    if (!user) {
      throw new HttpError(401, 'Invalid or expired token');
    }
    req.user = user;
  }
  next();
};

export function currentUser(req: Request): AuthUser {
  if (!req.user) {
    throw new HttpError(401, 'Authentication required');
  }
  return req.user;
}
