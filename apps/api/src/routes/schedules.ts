import { Router, type Request } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../lib/auth.js';
import {
  copyTasks,
  createSchedule,
  deleteSchedule,
  findChildForUser,
  findScheduleByChildAndDate,
  findScheduleForUser,
  setScheduleDate,
  tasksForSchedule,
  type Schedule,
} from '../db/feature-data.js';
import {
  createScheduleSchema,
  idParamSchema,
  scheduleQuerySchema,
  updateScheduleSchema,
} from '@starter/shared';

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth);

async function serializeSchedule(schedule: Schedule) {
  return { ...schedule, tasks: await tasksForSchedule(schedule.id) };
}

async function ownedSchedule(req: Request, id: number): Promise<Schedule> {
  const schedule = await findScheduleForUser(id, currentUser(req).id);
  if (!schedule) {
    throw new HttpError(404, 'Schedule not found');
  }
  return schedule;
}

schedulesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { childId, date } = parse(scheduleQuerySchema, req.query);
    if (!(await findChildForUser(childId, currentUser(req).id))) {
      throw new HttpError(404, 'Child not found');
    }
    const schedule = await findScheduleByChildAndDate(childId, date);
    if (!schedule) {
      throw new HttpError(404, 'Schedule not found');
    }
    res.json(await serializeSchedule(schedule));
  }),
);

schedulesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { childId, date, copyFrom } = parse(createScheduleSchema, req.body);
    if (!(await findChildForUser(childId, currentUser(req).id))) {
      throw new HttpError(404, 'Child not found');
    }
    if (await findScheduleByChildAndDate(childId, date)) {
      throw new HttpError(409, 'A schedule already exists for this child and date');
    }
    let source: Schedule | undefined;
    if (copyFrom !== undefined) {
      source = await findScheduleByChildAndDate(childId, copyFrom);
      if (!source) {
        throw new HttpError(404, 'No schedule found to copy from');
      }
    }
    const schedule = await createSchedule(childId, date);
    if (source) {
      await copyTasks(source.id, schedule.id);
    }
    res.status(201).json(await serializeSchedule(schedule));
  }),
);

schedulesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const { date } = parse(updateScheduleSchema, req.body);
    const schedule = await ownedSchedule(req, id);
    if (date !== schedule.schedule_date && (await findScheduleByChildAndDate(schedule.child_id, date))) {
      throw new HttpError(409, 'A schedule already exists for this child and date');
    }
    await setScheduleDate(schedule, date);
    res.json(await serializeSchedule(schedule));
  }),
);

schedulesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const schedule = await ownedSchedule(req, id);
    await deleteSchedule(schedule.id);
    res.json({ success: true });
  }),
);