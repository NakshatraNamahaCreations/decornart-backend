"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const addItem = z.object({ productId: objectId });
const itemParam = z.object({ productId: objectId });

module.exports = { addItem, itemParam };
