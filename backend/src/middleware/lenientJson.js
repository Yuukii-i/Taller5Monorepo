import express from 'express';

/**
 * Middleware chain that parses incoming request bodies leniently as JSON
 * regardless of the Content-Type header.
 *
 * Strips UTF-8 BOM, trims whitespace, parses JSON.
 * Returns 400 for empty, whitespace, or invalid JSON.
 * Returns 413 if the payload exceeds 100kb limit.
 * Never throws.
 *
 * @returns {Array<import('express').RequestHandler>}
 */
export function lenientJsonBody() {
  const textParser = express.text({ type: () => true, limit: '100kb' });

  return [
    (req, res, next) => {
      textParser(req, res, (err) => {
        if (err) {
          if (
            err.status === 413 ||
            err.statusCode === 413 ||
            err.type === 'entity.too.large'
          ) {
            return res.status(413).json({
              ok: false,
              errors: [{ field: 'body', message: 'payload too large' }]
            });
          }
          return res.status(400).json({
            ok: false,
            errors: [{ field: 'body', message: 'invalid JSON' }]
          });
        }

        try {
          let raw = typeof req.body === 'string' ? req.body : '';
          if (raw.charCodeAt(0) === 0xFEFF) {
            raw = raw.slice(1);
          }
          const trimmed = raw.trim();
          if (trimmed === '') {
            return res.status(400).json({
              ok: false,
              errors: [{ field: 'body', message: 'invalid JSON' }]
            });
          }

          req.body = JSON.parse(trimmed);
          return next();
        } catch {
          return res.status(400).json({
            ok: false,
            errors: [{ field: 'body', message: 'invalid JSON' }]
          });
        }
      });
    }
  ];
}
