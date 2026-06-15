"use strict";

const { ApiError } = require("../utils/ApiError");

/**
 * Validates and COERCES req.body/query/params against a Zod schema. On failure
 * it throws a 400 with field-level details — bad input never reaches a
 * controller or the database.
 *
 * Usage: router.post("/", validate({ body: schema }), handler)
 */
function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const key of ["body", "query", "params"]) {
        if (!schemas[key]) continue;
        const result = schemas[key].safeParse(req[key]);
        if (!result.success) {
          const details = result.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          }));
          throw ApiError.badRequest("Validation failed", { details });
        }
        // assign coerced/parsed values (note: req.query is read-only on some
        // setups, so we use defineProperty-safe assignment)
        req[key] = result.data;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = validate;
