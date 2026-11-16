import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AuthRole, AuthUser } from '../lib/auth.js';
import { getDatabasePool } from './pool.js';

interface UserRow extends RowDataPacket {
  id: number | string;
  name: string;
  email: string;
  role: AuthRole;
}

interface LoginUserRow extends UserRow {
  password_hash: string | null;
}

function toAuthUser(row: UserRow): AuthUser {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('Database returned an invalid user id.');
  }
  return { id, name: row.name, email: row.email, role: row.role };
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
  role: AuthRole,
): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await getDatabasePool().execute<ResultSetHeader>(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role],
  );
  const id = Number(result.insertId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('Database did not return a valid user id after creation.');
  }
  return { id, name, email, role };
}

let dummyPasswordHash: Promise<string> | undefined;

export async function authenticateUser(email: string, password: string): Promise<AuthUser | undefined> {
  const [rows] = await getDatabasePool().execute<LoginUserRow[]>(
    `SELECT id, name, email, password_hash, role
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email],
  );
  const row = rows[0];
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hash('unused-password-for-timing-equalization', 12);
  }
  const passwordHash = row?.password_hash ?? await dummyPasswordHash;
  const passwordMatches = await bcrypt.compare(password, passwordHash);
  return row && row.password_hash && passwordMatches ? toAuthUser(row) : undefined;
}

export async function findUserById(id: number): Promise<AuthUser | undefined> {
  const [rows] = await getDatabasePool().execute<UserRow[]>(
    'SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1',
    [id],
  );
  const row = rows[0];
  return row ? toAuthUser(row) : undefined;
}
