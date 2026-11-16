import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { listActivities } from '../db/feature-data.js';

export const activitiesRouter = Router();
activitiesRouter.use(requireAuth);

activitiesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await listActivities());
  }),
);
