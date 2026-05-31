import type { Request, Response, NextFunction } from 'express'

/**
 * Project IDs are uuid v4 strings (see projectManager.createProject). Anywhere
 * we splice a project-id from user input into a filesystem path
 * (`path.join(DATA_DIR, 'projects', projectId, ...)`), we must reject anything
 * that isn't shaped like one — otherwise a request with `..%2F..%2Fetc` decodes
 * into a `..` path component and escapes the project tree.
 *
 * `pathSafety.resolveUnderRoot` is the structural backstop, but a fast format
 * check at the route boundary fails earlier with a clearer error message.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidProjectId(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

/**
 * Express middleware factory: rejects when the named param isn't a uuid.
 * Default param name is `id`; pass an explicit name for routes using a
 * different convention (`project_id`, `projectId`, etc.).
 *
 *   app.use('/api/projects/:id/ai-scripts', requireValidProjectIdParam(), aiScriptsRouter)
 *   router.use('/scripts-batch-preview/:project_id', requireValidProjectIdParam('project_id'))
 */
export function requireValidProjectIdParam(paramName: string = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isValidProjectId(req.params[paramName])) {
      res.status(400).json({ error: 'invalid project id' })
      return
    }
    next()
  }
}
