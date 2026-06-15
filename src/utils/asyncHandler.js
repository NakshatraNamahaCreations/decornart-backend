"use strict";

/**
 * THE fault-isolation primitive.
 *
 * Express does not catch rejected promises from async handlers on its own — an
 * unhandled rejection there can take down the whole process. Wrapping every
 * controller in asyncHandler guarantees any throw/reject is funneled to the
 * central error handler as a clean response. One route failing therefore
 * returns a 4xx/5xx for THAT request only; sibling routes are untouched.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
