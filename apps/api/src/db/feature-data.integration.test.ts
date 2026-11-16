import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
const jwtSecret = randomBytes(32).toString('hex');

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
}

const userIds = [1, 2] as const;
const alice = {
  Authorization: `Bearer ${jwt.sign({}, jwtSecret, {
    algorithm: 'HS256',
    subject: '1',
    expiresIn: '1h',
  })}`,
};
const bob = {
  Authorization: `Bearer ${jwt.sign({}, jwtSecret, {
    algorithm: 'HS256',
    subject: '2',
    expiresIn: '1h',
  })}`,
};
let activityId: number | undefined;
let defaultCardId: number | undefined;
let fixtureCreated = false;
let apiProcess: ChildProcess | undefined;
let apiUrl: string;
let closeDatabasePool: typeof import('./pool.js').closeDatabasePool;
let getDatabasePool: typeof import('./pool.js').getDatabasePool;

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
  const port = await unusedPort();
  apiUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, JWT_SECRET: jwtSecret, PORT: String(port) },
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

describe.skipIf(!enabled)('MySQL feature route integration', () => {
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

    await getDatabasePool().execute(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES (1, 'Integration Alice', 'integration-alice@special-project.invalid', NULL, 'caregiver'),
              (2, 'Integration Bob', 'integration-bob@special-project.invalid', NULL, 'caregiver')`,
    );
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
      await getDatabasePool().execute('DELETE FROM users WHERE id IN (?, ?)', [...userIds]);
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

  it('persists API records across a server restart and enforces ownership and cascades', async () => {
    await startApi();
    const fixtures = requireFixtureIds();
    const aliceChild = await request(apiUrl).post('/api/children').set(alice).send({
      name: 'Persistent Alice Child',
      age: 6,
      delay_domain: 'speech',
    });
    const bobChild = await request(apiUrl).post('/api/children').set(bob).send({
      name: 'Persistent Bob Child',
      age: 7,
      delay_domain: 'motor',
    });
    expect(aliceChild.status).toBe(201);
    expect(bobChild.status).toBe(201);
    const aliceChildren = await request(apiUrl).get('/api/children').set(alice);
    const bobChildren = await request(apiUrl).get('/api/children').set(bob);
    expect(aliceChildren.body.map((child: { id: number }) => child.id)).toContain(aliceChild.body.id);
    expect(bobChildren.body.map((child: { id: number }) => child.id)).toEqual([bobChild.body.id]);
    expect((await request(apiUrl).get(`/api/children/${aliceChild.body.id}`).set(bob)).status).toBe(404);
    expect((await request(apiUrl).put(`/api/children/${aliceChild.body.id}`).set(bob).send({ name: 'Not owned' })).status).toBe(404);
    expect((await request(apiUrl).delete(`/api/children/${aliceChild.body.id}`).set(bob)).status).toBe(404);

    const activities = await request(apiUrl).get('/api/activities').set(alice);
    expect(activities.status).toBe(200);
    expect(activities.body.some((activity: { id: number }) => activity.id === fixtures.activityId)).toBe(true);

    const date = '2099-12-30';
    const schedule = await request(apiUrl).post('/api/schedules').set(alice).send({
      childId: aliceChild.body.id,
      date,
    });
    expect(schedule.status).toBe(201);
    const bobSchedule = await request(apiUrl).post('/api/schedules').set(bob).send({
      childId: bobChild.body.id,
      date,
    });
    expect(bobSchedule.status).toBe(201);
    const bobTask = await request(apiUrl).post('/api/tasks').set(bob).send({
      scheduleId: bobSchedule.body.id,
      activityId: fixtures.activityId,
    });
    expect(bobTask.status).toBe(201);
    expect((await request(apiUrl).get('/api/schedules').set(bob).query({
      childId: aliceChild.body.id,
      date,
    })).status).toBe(404);
    expect((await request(apiUrl).post('/api/tasks').set(bob).send({
      scheduleId: schedule.body.id,
      activityId: fixtures.activityId,
    })).status).toBe(404);
    const task = await request(apiUrl).post('/api/tasks').set(alice).send({
      scheduleId: schedule.body.id,
      activityId: fixtures.activityId,
    });
    expect(task.status).toBe(201);
    const secondTask = await request(apiUrl).post('/api/tasks').set(alice).send({
      scheduleId: schedule.body.id,
      name: 'Integration custom task',
      icon: '⭐',
    });
    expect(secondTask.status).toBe(201);
    expect((await request(apiUrl).put(`/api/tasks/${secondTask.body.id}`).set(alice).send({
      position: 1,
      start_time: '08:15',
      duration_min: 10,
    })).status).toBe(200);
    const completed = await request(apiUrl)
      .patch(`/api/tasks/${task.body.id}/complete`)
      .set(alice)
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
    const persistedChild = await request(apiUrl).get(`/api/children/${aliceChild.body.id}`).set(alice);
    const persistedSchedule = await request(apiUrl).get('/api/schedules').set(alice).query({
      childId: aliceChild.body.id,
      date,
    });
    expect(persistedChild.status).toBe(200);
    expect(persistedSchedule.status).toBe(200);
    expect(persistedSchedule.body.tasks).toMatchObject([
      { id: secondTask.body.id, position: 1, start_time: '08:15', duration_min: 10, status: 'pending' },
      { id: task.body.id, position: 2, status: 'done', completed_at: completed.body.completed_at },
    ]);
    expect((await request(apiUrl).put(`/api/tasks/${task.body.id}`).set(bob).send({ duration_min: 5 })).status).toBe(404);

    expect((await request(apiUrl).delete(`/api/children/${aliceChild.body.id}`).set(alice)).status).toBe(200);
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
    expect((await request(apiUrl).get('/api/schedules').set(bob).query({
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
  describe('MySQL feature route integration', () => {
    it.skip(`requires ${missingConfig.join(', ')}`, () => {});
  });
}
