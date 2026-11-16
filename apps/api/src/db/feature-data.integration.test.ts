import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadEnv({ path: fileURLToPath(new URL('../../.env.test', import.meta.url)), override: true });

const databaseConfig = {
  host: process.env.DB_TEST_HOST,
  port: process.env.DB_TEST_PORT,
  user: process.env.DB_TEST_USER,
  password: process.env.DB_TEST_PASSWORD,
  name: process.env.DB_TEST_NAME,
};
const missingConfig = Object.entries(databaseConfig)
  .filter(([, value]) => value === undefined)
  .map(([key]) => `DB_TEST_${key.toUpperCase()}`);
const enabled = missingConfig.length === 0;
const integrationJwtSecret = 'integration-test-secret-not-for-deployment-32-bytes-minimum';

if (enabled) {
  if (!databaseConfig.name?.toLowerCase().endsWith('_test')) {
    throw new Error('DB_TEST_NAME must end with "_test" to protect non-test databases.');
  }
  if (databaseConfig.name === process.env.DB_NAME) {
    throw new Error('DB_TEST_NAME must not match DB_NAME.');
  }
  process.env.DB_HOST = databaseConfig.host;
  process.env.DB_PORT = databaseConfig.port;
  process.env.DB_USER = databaseConfig.user;
  process.env.DB_PASSWORD = databaseConfig.password;
  process.env.DB_NAME = databaseConfig.name;
  process.env.JWT_SECRET = integrationJwtSecret;
}

const aliceEmail = 'integration-alice@special-project.invalid';
const bobEmail = 'integration-bob@special-project.invalid';
const integrationPassword = 'Integration password 123!';
let aliceToken: string | undefined;
let bobToken: string | undefined;
let activityId: number | undefined;
let defaultCardId: number | undefined;
let fixtureCreated = false;
let apiProcess: ChildProcess | undefined;
let apiUrl: string;
let closeDatabasePool: typeof import('./pool.js').closeDatabasePool;
let getDatabasePool: typeof import('./pool.js').getDatabasePool;

function aliceAuth(): { Authorization: string } {
  if (!aliceToken) {
    throw new Error('Alice integration account has not logged in.');
  }
  return { Authorization: `Bearer ${aliceToken}` };
}

function bobAuth(): { Authorization: string } {
  if (!bobToken) {
    throw new Error('Bob integration account has not logged in.');
  }
  return { Authorization: `Bearer ${bobToken}` };
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a local API test port.');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function startApi(): Promise<void> {
  if (apiProcess && apiProcess.exitCode === null && apiProcess.signalCode === null) {
    return;
  }
  const port = await unusedPort();
  apiUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess = child;
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Test API exited before becoming ready: ${output}`);
    }
    try {
      const response = await fetch(`${apiUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopApi();
  throw new Error(`Test API did not become ready: ${output}`);
}

async function stopApi(): Promise<void> {
  if (!apiProcess) {
    return;
  }
  const processToStop = apiProcess;
  apiProcess = undefined;
  if (processToStop.exitCode === null && processToStop.signalCode === null) {
    processToStop.kill('SIGTERM');
    await new Promise<void>((resolve, reject) => {
      if (processToStop.exitCode !== null || processToStop.signalCode !== null) {
        resolve();
        return;
      }
      processToStop.once('error', reject);
      processToStop.once('exit', () => resolve());
    });
  }
}

function requireFixtureIds(): { activityId: number; defaultCardId: number } {
  if (activityId === undefined || defaultCardId === undefined) {
    throw new Error('MySQL integration fixtures were not initialized.');
  }
  return { activityId, defaultCardId };
}

describe.skipIf(!enabled)('MySQL auth and feature route integration', () => {
  beforeAll(async () => {
    const poolModule = await import('./pool.js');
    closeDatabasePool = poolModule.closeDatabasePool;
    getDatabasePool = poolModule.getDatabasePool;

    const schema = await readFile(new URL('../../schema.sql', import.meta.url), 'utf8');
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
      await getDatabasePool().query(statement);
    }

    const [existingUsers] = await getDatabasePool().query<Array<RowDataPacket & { count: number }>>(
      'SELECT COUNT(*) AS count FROM users',
    );
    const userCount = existingUsers[0]?.count;
    if (userCount === undefined) {
      throw new Error('Could not inspect the dedicated MySQL test database.');
    }
    if (Number(userCount) !== 0) {
      throw new Error('The dedicated MySQL test database must not contain users.');
    }
    fixtureCreated = true;

    const [activityResult] = await getDatabasePool().execute<ResultSetHeader>(
      'INSERT INTO activities (name, icon, category) VALUES (?, ?, ?)',
      [`Integration activity ${Date.now()}`, '⭐', 'other'],
    );
    activityId = Number(activityResult.insertId);
    const [cardResult] = await getDatabasePool().execute<ResultSetHeader>(
      'INSERT INTO picture_cards (child_id, category, label, icon) VALUES (NULL, ?, ?, ?)',
      ['Food', `Integration default ${Date.now()}`, '💧'],
    );
    defaultCardId = Number(cardResult.insertId);
  });

  afterAll(async () => {
    await stopApi();
    if (fixtureCreated) {
      await getDatabasePool().execute('DELETE FROM users WHERE email IN (?, ?)', [aliceEmail, bobEmail]);
      if (activityId !== undefined) {
        await getDatabasePool().execute('DELETE FROM activities WHERE id = ?', [activityId]);
      }
      if (defaultCardId !== undefined) {
        await getDatabasePool().execute(
          'DELETE FROM picture_cards WHERE id = ? AND child_id IS NULL',
          [defaultCardId],
        );
      }
    }
    await closeDatabasePool();
  });

  it('registers and logs in users, returns the current user, and rejects invalid or expired JWTs', async () => {
    await startApi();
    const aliceRegistration = await request(apiUrl).post('/api/auth/register').send({
      name: 'Integration Alice',
      email: 'Integration-Alice@special-project.invalid',
      password: integrationPassword,
      role: 'caregiver',
    });
    expect(aliceRegistration.status).toBe(201);
    expect(aliceRegistration.body.user).toEqual({
      id: expect.any(Number),
      name: 'Integration Alice',
      email: aliceEmail,
      role: 'caregiver',
    });
    expect(aliceRegistration.body.token).toEqual(expect.any(String));
    expect(aliceRegistration.body).not.toHaveProperty('password');
    expect(aliceRegistration.body).not.toHaveProperty('password_hash');

    const [passwordRows] = await getDatabasePool().execute<Array<RowDataPacket & {
      password_hash: string | null;
    }>>('SELECT password_hash FROM users WHERE email = ?', [aliceEmail]);
    expect(passwordRows[0]?.password_hash).toMatch(/^\$2[aby]\$/);

    const weakPassword = await request(apiUrl).post('/api/auth/register').send({
      name: 'Weak Password',
      email: 'weak-password@special-project.invalid',
      password: 'short',
      role: 'caregiver',
    });
    expect(weakPassword.status).toBe(400);

    const duplicateEmail = await request(apiUrl).post('/api/auth/register').send({
      name: 'Duplicate User',
      email: aliceEmail,
      password: integrationPassword,
      role: 'caregiver',
    });
    expect(duplicateEmail.status).toBe(409);

    const invalidLogin = await request(apiUrl).post('/api/auth/login').send({
      email: aliceEmail,
      password: 'incorrect password',
    });
    expect(invalidLogin.status).toBe(401);
    expect(invalidLogin.body).toEqual({ error: 'Invalid email or password' });

    const aliceLogin = await request(apiUrl).post('/api/auth/login').send({
      email: aliceEmail,
      password: integrationPassword,
    });
    expect(aliceLogin.status).toBe(200);
    aliceToken = aliceLogin.body.token as string;
    const currentUser = await request(apiUrl).get('/api/auth/me').set(aliceAuth());
    expect(currentUser.status).toBe(200);
    expect(currentUser.body).toEqual(aliceRegistration.body.user);

    const bobRegistration = await request(apiUrl).post('/api/auth/register').send({
      name: 'Integration Bob',
      email: bobEmail,
      password: integrationPassword,
      role: 'ot',
    });
    expect(bobRegistration.status).toBe(201);
    const bobLogin = await request(apiUrl).post('/api/auth/login').send({
      email: bobEmail,
      password: integrationPassword,
    });
    expect(bobLogin.status).toBe(200);
    bobToken = bobLogin.body.token as string;

    const expiredToken = jwt.sign(
      {
        name: 'Integration Alice',
        email: aliceEmail,
        role: 'caregiver',
      },
      integrationJwtSecret,
      {
        algorithm: 'HS256',
        audience: 'special-project-client',
        expiresIn: -1,
        issuer: 'special-project-api',
        subject: String(aliceRegistration.body.user.id),
      },
    );
    for (const authorization of [
      undefined,
      'Bearer forged.token.value',
      `Bearer ${expiredToken}`,
    ]) {
      const req = request(apiUrl).get('/api/auth/me');
      if (authorization) {
        req.set('Authorization', authorization);
      }
      const response = await req;
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual(expect.any(String));
    }
  });

  it('persists API records across a server restart and enforces ownership and cascades', async () => {
    await startApi();
    const fixtures = requireFixtureIds();
    const aliceChild = await request(apiUrl).post('/api/children').set(aliceAuth()).send({
      name: 'Persistent Alice Child',
      age: 6,
      delay_domain: 'speech',
    });
    const bobChild = await request(apiUrl).post('/api/children').set(bobAuth()).send({
      name: 'Persistent Bob Child',
      age: 7,
      delay_domain: 'motor',
    });
    expect(aliceChild.status).toBe(201);
    expect(bobChild.status).toBe(201);
    const aliceChildren = await request(apiUrl).get('/api/children').set(aliceAuth());
    const bobChildren = await request(apiUrl).get('/api/children').set(bobAuth());
    expect(aliceChildren.body.map((child: { id: number }) => child.id)).toContain(aliceChild.body.id);
    expect(bobChildren.body.map((child: { id: number }) => child.id)).toEqual([bobChild.body.id]);
    expect((await request(apiUrl).get(`/api/children/${aliceChild.body.id}`).set(bobAuth())).status).toBe(404);
    expect((await request(apiUrl).put(`/api/children/${aliceChild.body.id}`).set(bobAuth()).send({ name: 'Not owned' })).status).toBe(404);
    expect((await request(apiUrl).delete(`/api/children/${aliceChild.body.id}`).set(bobAuth())).status).toBe(404);

    const activities = await request(apiUrl).get('/api/activities').set(aliceAuth());
    expect(activities.status).toBe(200);
    expect(activities.body.some((activity: { id: number }) => activity.id === fixtures.activityId)).toBe(true);

    const date = '2099-12-30';
    const schedule = await request(apiUrl).post('/api/schedules').set(aliceAuth()).send({
      childId: aliceChild.body.id,
      date,
    });
    expect(schedule.status).toBe(201);
    const bobSchedule = await request(apiUrl).post('/api/schedules').set(bobAuth()).send({
      childId: bobChild.body.id,
      date,
    });
    expect(bobSchedule.status).toBe(201);
    const bobTask = await request(apiUrl).post('/api/tasks').set(bobAuth()).send({
      scheduleId: bobSchedule.body.id,
      activityId: fixtures.activityId,
    });
    expect(bobTask.status).toBe(201);
    expect((await request(apiUrl).get('/api/schedules').set(bobAuth()).query({
      childId: aliceChild.body.id,
      date,
    })).status).toBe(404);
    expect((await request(apiUrl).post('/api/tasks').set(bobAuth()).send({
      scheduleId: schedule.body.id,
      activityId: fixtures.activityId,
    })).status).toBe(404);
    const task = await request(apiUrl).post('/api/tasks').set(aliceAuth()).send({
      scheduleId: schedule.body.id,
      activityId: fixtures.activityId,
    });
    expect(task.status).toBe(201);
    const secondTask = await request(apiUrl).post('/api/tasks').set(aliceAuth()).send({
      scheduleId: schedule.body.id,
      name: 'Integration custom task',
      icon: '⭐',
    });
    expect(secondTask.status).toBe(201);
    expect((await request(apiUrl).put(`/api/tasks/${secondTask.body.id}`).set(aliceAuth()).send({
      position: 1,
      start_time: '08:15',
      duration_min: 10,
    })).status).toBe(200);
    const completed = await request(apiUrl)
      .patch(`/api/tasks/${task.body.id}/complete`)
      .set(aliceAuth())
      .send({ done: true });
    expect(completed.body.status).toBe('done');
    expect(completed.body.completed_at).toBeTruthy();

    const [customCardResult] = await getDatabasePool().execute<ResultSetHeader>(
      'INSERT INTO picture_cards (child_id, category, label, icon) VALUES (?, ?, ?, ?)',
      [aliceChild.body.id, 'Food', `Custom child card ${Date.now()}`, '🥛'],
    );
    const customCardId = Number(customCardResult.insertId);
    const [bobCardResult] = await getDatabasePool().execute<ResultSetHeader>(
      'INSERT INTO picture_cards (child_id, category, label, icon) VALUES (?, ?, ?, ?)',
      [bobChild.body.id, 'Food', `Bob child card ${Date.now()}`, '🥛'],
    );
    const bobCardId = Number(bobCardResult.insertId);

    await stopApi();
    await startApi();
    const persistedChild = await request(apiUrl).get(`/api/children/${aliceChild.body.id}`).set(aliceAuth());
    const persistedSchedule = await request(apiUrl).get('/api/schedules').set(aliceAuth()).query({
      childId: aliceChild.body.id,
      date,
    });
    expect(persistedChild.status).toBe(200);
    expect(persistedSchedule.status).toBe(200);
    expect(persistedSchedule.body.tasks).toMatchObject([
      { id: secondTask.body.id, position: 1, start_time: '08:15', duration_min: 10, status: 'pending' },
      { id: task.body.id, position: 2, status: 'done', completed_at: completed.body.completed_at },
    ]);
    expect((await request(apiUrl).put(`/api/tasks/${task.body.id}`).set(bobAuth()).send({ duration_min: 5 })).status).toBe(404);

    expect((await request(apiUrl).delete(`/api/children/${aliceChild.body.id}`).set(aliceAuth())).status).toBe(200);
    const [cascadedRows] = await getDatabasePool().query<Array<RowDataPacket & {
      schedules: number;
      tasks: number;
      custom_cards: number;
    }>>(
      `SELECT
         (SELECT COUNT(*) FROM schedules WHERE id = ?) AS schedules,
         (SELECT COUNT(*) FROM tasks WHERE id IN (?, ?)) AS tasks,
         (SELECT COUNT(*) FROM picture_cards WHERE id = ?) AS custom_cards`,
      [schedule.body.id, task.body.id, secondTask.body.id, customCardId],
    );
    const cascade = cascadedRows[0];
    if (!cascade) {
      throw new Error('Could not inspect cascaded MySQL records.');
    }
    expect(Number(cascade.schedules)).toBe(0);
    expect(Number(cascade.tasks)).toBe(0);
    expect(Number(cascade.custom_cards)).toBe(0);
    expect((await request(apiUrl).get('/api/schedules').set(bobAuth()).query({
      childId: bobChild.body.id,
      date,
    })).status).toBe(200);
    const [foreignRecords] = await getDatabasePool().query<Array<RowDataPacket & {
      child: number;
      schedule: number;
      task: number;
      custom_card: number;
    }>>(
      `SELECT
         (SELECT COUNT(*) FROM children WHERE id = ?) AS child,
         (SELECT COUNT(*) FROM schedules WHERE id = ?) AS schedule,
         (SELECT COUNT(*) FROM tasks WHERE id = ?) AS task,
         (SELECT COUNT(*) FROM picture_cards WHERE id = ?) AS custom_card`,
      [bobChild.body.id, bobSchedule.body.id, bobTask.body.id, bobCardId],
    );
    const foreign = foreignRecords[0];
    if (!foreign) {
      throw new Error("Could not inspect another user's records after cascade deletion.");
    }
    expect(Number(foreign.child)).toBe(1);
    expect(Number(foreign.schedule)).toBe(1);
    expect(Number(foreign.task)).toBe(1);
    expect(Number(foreign.custom_card)).toBe(1);

    const [preservedRows] = await getDatabasePool().query<Array<RowDataPacket & {
      foreign_children: number;
      default_cards: number;
    }>>(
      `SELECT
         (SELECT COUNT(*) FROM children WHERE id = ?) AS foreign_children,
         (SELECT COUNT(*) FROM picture_cards WHERE id = ? AND child_id IS NULL) AS default_cards`,
      [bobChild.body.id, fixtures.defaultCardId],
    );
    const preserved = preservedRows[0];
    if (!preserved) {
      throw new Error('Could not inspect preserved MySQL records.');
    }
    expect(Number(preserved.foreign_children)).toBe(1);
    expect(Number(preserved.default_cards)).toBe(1);
    await stopApi();
  }, 30_000);
});

if (!enabled) {
  describe('MySQL auth and feature route integration', () => {
    it.skip(`requires ${missingConfig.join(', ')}`, () => {});
  });
}
