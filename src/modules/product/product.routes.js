"use strict";

const router = require("express").Router();
const ctrl = require("./product.controller");
const v = require("./product.validation");
const validate = require("../../middleware/validate");

router.get("/", validate({ query: v.listQuery }), ctrl.list);
router.get("/:slug", validate({ params: v.slugParam }), ctrl.getBySlug);
router.get("/:slug/related", validate({ params: v.slugParam }), ctrl.getRelated);

module.exports = router;
