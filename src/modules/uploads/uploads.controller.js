"use strict";

const { v2: cloudinary } = require("cloudinary");
const asyncHandler = require("../../utils/asyncHandler");
const { ApiError } = require("../../utils/ApiError");

// Signs a Cloudinary upload request server-side so the api_secret never
// reaches the browser. The admin frontend calls this endpoint, receives a
// short-lived signature + timestamp, and uploads the file directly to
// Cloudinary. Gated to admin role by the route-level middleware.
exports.sign = asyncHandler(async (req, res) => {
  const CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const API_KEY = (process.env.CLOUDINARY_API_KEY || "").trim();
  const API_SECRET = (process.env.CLOUDINARY_API_SECRET || "").trim();

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw ApiError.unavailable("Cloudinary is not configured on the server.");
  }

  const folder = String(
    (req.body && req.body.folder) || "Decor N Art/products"
  );
  const timestamp = Math.floor(Date.now() / 1000);

  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
  });

  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    API_SECRET
  );

  res.json({
    success: true,
    data: {
      signature,
      timestamp,
      apiKey: API_KEY,
      cloudName: CLOUD_NAME,
      folder,
    },
  });
});
