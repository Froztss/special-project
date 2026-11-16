import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../lib/auth.js';
import {
  createChildForUser,
  deleteChildForUser,
  findChildForUser,
  listChildrenForUser,
  updateChildForUser,
} from '../db/feature-data.js';
import { createChildSchema, idParamSchema, updateChildSchema } from '@starter/shared';

export const childrenRouter = Router();
childrenRouter.use(requireAuth);

childrenRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listChildrenForUser(currentUser(req).id));
  }),
);

childrenRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(createChildSchema, req.body);
    const child = await createChildForUser(currentUser(req).id, input);
    res.status(201).json(child);
  }),
);

childrenRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const child = await findChildForUser(id, currentUser(req).id);
    if (!child) throw new HttpError(404, 'Child not found');
    res.json(child);
  }),
);

childrenRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const patch = parse(updateChildSchema, req.body);
    const child = await updateChildForUser(id, currentUser(req).id, patch);
    if (!child) throw new HttpError(404, 'Child not found');
    res.json(child);
  }),
);

childrenRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    if (!(await deleteChildForUser(id, currentUser(req).id))) {
      throw new HttpError(404, 'Child not found');
    }
    res.json({ success: true });
  }),
);
