import { Router, type Request } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../lib/auth.js';
import {
  addTask,
  applyTaskUpdate,
  findActivity,
  findScheduleForUser,
  findTaskForUser,
  isPredefinedIcon,
  removeTask,
  setTaskCompletion,
  tasksForSchedule,
  type Task,
} from '../db/feature-data.js';
import {
  completeTaskSchema,
  createTaskSchema,
  idParamSchema,
  updateTaskSchema,
} from '@starter/shared';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

async function ownedTask(req: Request, id: number): Promise<Task> {
  const task = await findTaskForUser(id, currentUser(req).id);
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }
  return task;
}

tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(createTaskSchema, req.body);
    const schedule = await findScheduleForUser(body.scheduleId, currentUser(req).id);
    if (!schedule) {
      throw new HttpError(404, 'Schedule not found');
    }
    let task: Task;
    if (body.activityId !== undefined) {
      const activity = await findActivity(body.activityId);
      if (!activity) {
        throw new HttpError(400, 'Unknown activity');
      }
      task = await addTask(schedule.id, {
        activity_id: activity.id,
        name: activity.name,
        icon: activity.icon,
      });
    } else {
      if (!(await isPredefinedIcon(body.icon!))) {
        throw new HttpError(400, 'icon must be one of the predefined icons');
      }
      task = await addTask(schedule.id, {
        activity_id: null,
        name: body.name!,
        icon: body.icon!,
      });
    }
    res.status(201).json(task);
  }),
);

tasksRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const patch = parse(updateTaskSchema, req.body);
    const task = await ownedTask(req, id);
    if (patch.position !== undefined) {
      const count = (await tasksForSchedule(task.schedule_id)).length;
      if (patch.position > count) {
        throw new HttpError(400, `position must be between 1 and ${count}`);
      }
    }
    const updated = await applyTaskUpdate(task, patch);
    res.json(updated);
  }),
);

tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const task = await ownedTask(req, id);
    await removeTask(task);
    res.json({ success: true });
  }),
);

tasksRouter.patch(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const { done } = parse(completeTaskSchema, req.body);
    const task = await ownedTask(req, id);
    const updated = await setTaskCompletion(task, done);
    res.json(updated);
  }),
);