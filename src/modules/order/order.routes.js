"use strict";

const router = require("express").Router();
const ctrl = require("./order.controller");
const v = require("./order.validation");
const validate = require("../../middleware/validate");
const { protect } = require("../../middleware/auth");

router.use(protect); // all order routes require a logged-in user

router.post("/", validate({ body: v.create }), ctrl.create);
router.post("/verify", validate({ body: v.verify }), ctrl.verify);
router.get("/", validate({ query: v.listQuery }), ctrl.list);
router.get("/:id", validate({ params: v.idParam }), ctrl.getOne);

module.exports = router;
