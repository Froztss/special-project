import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../src/db/pool.js';
import { applySchema, resetDb, runSeed } from '../helpers/db.js';

beforeAll(() => {
  applySchema();
});

beforeEach(async () => {
  await resetDb();
});

async function count(table: string, where = ''): Promise<number> {
  const [rows] = await getDatabasePool().query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table} ${where}`);
  return Number(rows[0]?.n);
}

interface SeededTaskRow extends RowDataPacket {
  id: number;
  activity_id: number;
  name: string;
  icon: string;
  start_time: string;
  duration_min: number;
  status: string;
  completed_at: string | null;
}

describe('1.3 seed script', () => {
  it('seeds the activity library with icons and categories', async () => {
    runSeed();
    expect(await count('activities')).toBe(11);
    const [rows] = await getDatabasePool().query<RowDataPacket[]>(
      'SELECT name, icon, category FROM activities WHERE name = ?',
      ['Brush teeth'],
    );
    expect(rows[0]).toMatchObject({ name: 'Brush teeth', icon: '🪥', category: 'hygiene' });
  });

  it('seeds default picture cards in the four required categories', async () => {
    runSeed();
    expect(await count('picture_cards', 'WHERE child_id IS NULL')).toBe(10);
    const [rows] = await getDatabasePool().query<RowDataPacket[]>(
      'SELECT DISTINCT category FROM picture_cards WHERE child_id IS NULL',
    );
    expect(rows.map((r) => String(r.category)).sort()).toEqual(['Activities', 'Emotions', 'Food', 'Needs']);
  });

  it('seeds three demo children with sample schedules for today', async () => {
    runSeed();
    expect(await count('users')).toBe(1);
    expect(await count('children')).toBe(3);
    expect(await count('schedules')).toBe(3);
    expect(await count('tasks')).toBe(15);
    const [rows] = await getDatabasePool().query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM schedules WHERE schedule_date = CURRENT_DATE()',
    );
    expect(Number(rows[0]?.n)).toBe(3);
    const [tasks] = await getDatabasePool().query<RowDataPacket[]>(
      'SELECT start_time, duration_min FROM tasks WHERE start_time IS NOT NULL AND duration_min IS NOT NULL',
    );
    expect(tasks.length).toBe(15);
  });

  it('preserves task edits and completion across repeated runs', async () => {
    runSeed();

    const [seededTasks] = await getDatabasePool().query<SeededTaskRow[]>(
      `SELECT tasks.id, tasks.activity_id, tasks.name, tasks.icon,
              TIME_FORMAT(tasks.start_time, '%H:%i:%s') AS start_time,
              tasks.duration_min, tasks.status,
              DATE_FORMAT(tasks.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at
       FROM tasks
       JOIN schedules ON schedules.id = tasks.schedule_id
       JOIN children ON children.id = schedules.child_id
       JOIN users ON users.id = children.user_id
       WHERE users.email = ? AND children.name = ? AND schedules.schedule_date = CURRENT_DATE()
         AND tasks.position = 1`,
      ['demo@special-project.invalid', 'Avery'],
    );
    const task = seededTasks[0];
    if (!task) {
      throw new Error('Expected the seeded Avery task to exist.');
    }

    const [activities] = await getDatabasePool().query<Array<RowDataPacket & { id: number }>>(
      'SELECT id FROM activities WHERE name = ?',
      ['Play'],
    );
    const alternateActivity = activities[0];
    if (!alternateActivity) {
      throw new Error('Expected the seeded Play activity to exist.');
    }

    await getDatabasePool().execute(
      `UPDATE tasks
       SET activity_id = ?, name = ?, icon = ?, start_time = ?, duration_min = ?,
           status = 'done', completed_at = ?
       WHERE id = ?`,
      [alternateActivity.id, 'User-edited task', '⭐', '09:17:00', 42, '2026-03-04 12:34:56', task.id],
    );
    runSeed();

    expect(await count('activities')).toBe(11);
    expect(await count('picture_cards', 'WHERE child_id IS NULL')).toBe(10);
    expect(await count('users')).toBe(1);
    expect(await count('children')).toBe(3);
    expect(await count('schedules')).toBe(3);
    expect(await count('tasks')).toBe(15);

    const [preservedTasks] = await getDatabasePool().query<SeededTaskRow[]>(
      `SELECT id, activity_id, name, icon,
              TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
              duration_min, status,
              DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at
       FROM tasks
       WHERE id = ?`,
      [task.id],
    );
    expect(preservedTasks[0]).toMatchObject({
      activity_id: alternateActivity.id,
      name: 'User-edited task',
      icon: '⭐',
      start_time: '09:17:00',
      duration_min: 42,
      status: 'done',
      completed_at: '2026-03-04 12:34:56',
    });
  });
});