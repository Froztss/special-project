import { createAccessToken, type AuthUser } from '../lib/auth.js';

export const aliceUser: AuthUser = {
  id: 1,
  name: 'Alice Caregiver',
  email: 'alice@example.com',
  role: 'caregiver',
};

export const bobUser: AuthUser = {
  id: 2,
  name: 'Bob OT',
  email: 'bob@example.com',
  role: 'ot',
};

const [aliceToken, bobToken] = await Promise.all([
  createAccessToken(aliceUser),
  createAccessToken(bobUser),
]);

export const alice = { Authorization: `Bearer ${aliceToken}` };
export const bob = { Authorization: `Bearer ${bobToken}` };
