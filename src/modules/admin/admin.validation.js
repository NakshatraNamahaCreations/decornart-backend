"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// Legacy list — retained only for callers that still import `CATEGORIES`.
// Real category slugs live in the DB (Category collection); we now accept
// any well-formed slug and validate existence at the service layer.
const CATEGORIES = [
  "flower-basket-materials",
  "gift-cards",
  "pipe-cleaners",
  "gift-box",
  "craft-essentials",
  "crochet-materials",
  "ribbons",
  "wrapping-papers",
];

const categoryEnum = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+$/, "Invalid category slug");

// Specifications block — every key is optional so partial sets are fine.
const specsSchema = z
  .object({
    material: z.string().trim().max(120).optional(),
    pack: z.string().trim().max(120).optional(),
    origin: z.string().trim().max(120).optional(),
    finish: z.string().trim().max(120).optional(),
    thickness: z.string().trim().max(120).optional(),
    length: z.string().trim().max(120).optional(),
  })
  .partial()
  .optional();

const faqSchema = z.object({
  q: z.string().trim().min(1).max(300),
  a: z.string().trim().min(1).max(2000),
});

const reviewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rating: z.coerce.number().int().min(1).max(5),
  date: z.string().trim().max(40).optional().or(z.literal("")),
  title: z.string().trim().max(160).optional().or(z.literal("")),
  body: z.string().trim().min(1).max(2000),
  verified: z.boolean().optional(),
  helpful: z.coerce.number().int().min(0).optional(),
});

// Priced variants (e.g. "6mm" / "8mm"). Only `name` and `price` are required.
const variantSchema = z.object({
  name: z.string().trim().min(1).max(60),
  price: z.coerce.number().min(0),
  stock: z.coerce.number().int().min(0).optional(),
  sku: z.string().trim().max(80).optional(),
  image: z.string().trim().url().max(600).optional().or(z.literal("")),
});

const productBody = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, hyphens"),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  price: z.coerce.number().min(0),
  category: categoryEnum,
  // Craft-supply detail fields.
  packContents: z.array(z.string().trim().max(300)).optional(),
  usage: z.array(z.string().trim().max(300)).optional(),
  specs: specsSchema,
  faqs: z.array(faqSchema).optional(),
  reviews: z.array(reviewSchema).optional(),
  // Optional color variants (e.g., ["Red", "Blue"]). Empty array means
  // no color selector on the storefront.
  colors: z.array(z.string().trim().min(1).max(40)).optional(),
  // Feature badges rendered under the gallery on the product page. Icon
  // is a key into the storefront's shared icon library (e.g. "soft",
  // "bend"); an empty icon renders the row without a glyph.
  featureBadges: z
    .array(
      z.object({
        icon: z.string().trim().max(30).optional().or(z.literal("")),
        title: z.string().trim().min(1).max(40),
        copy: z.string().trim().max(60).optional().or(z.literal("")),
      })
    )
    .max(8)
    .optional(),
  // Optional per-colour image overrides. When the shopper picks a colour
  // in this list, the storefront swaps the hero image. Admins fill this
  // in from the pipe-cleaners product form.
  colorImages: z
    .array(
      z.object({
        color: z.string().trim().min(1).max(40),
        image: z.string().trim().url(),
      })
    )
    .optional(),
  // Optional hex overrides for custom (non-preset) colors so the
  // storefront can render a real swatch instead of the grey fallback.
  colorSwatches: z
    .array(
      z.object({
        color: z.string().trim().min(1).max(40),
        hex: z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex"),
      })
    )
    .optional(),
  // Optional product video. `url` accepts any http(s) link (Cloudinary
  // MP4, YouTube, Vimeo, …); storefront picks the right renderer.
  // Kept loose intentionally — the storefront handles arbitrary strings
  // and we don't want a subtle Zod `.url()` mismatch to strip the field.
  video: z
    .object({
      url: z.string().trim().max(600).optional(),
      title: z.string().trim().max(80).optional(),
    })
    .optional(),
  // Optional priced variants — see variantSchema above.
  variants: z.array(variantSchema).optional(),
  // Section label rendered above the variant chips on the storefront.
  variantLabel: z.string().trim().max(40).optional().or(z.literal("")),
  // Legacy use-case tags — admin no longer writes these but the
  // storefront filter still reads them, so keep them accepted on the
  // payload for backwards compat with older data flows.
  occasion: z.string().trim().max(60).optional(),
  occasions: z.array(z.string().trim().max(60)).optional(),
  images: z.array(z.string().trim().url()).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  isNew: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
});

const productUpdate = productBody.partial();

const idParam = z.object({ id: objectId });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(["active", "draft", "archived", "all"]).optional(),
  category: categoryEnum.optional(),
});

// ── Orders ──────────────────────────────────────────────────────────────
const orderListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(120).optional(),
  status: z
    .enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "all"])
    .optional(),
  paymentStatus: z.enum(["created", "paid", "failed", "refunded", "all"]).optional(),
  dateFrom: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  dateTo: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

const orderStatusUpdate = z.object({
  status: z.enum([
    "pending",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
  ]),
  note: z.string().trim().max(500).optional(),
  tracking: z
    .object({
      awb: z.string().trim().max(80).optional(),
      courier: z.string().trim().max(80).optional(),
      url: z.string().trim().url().max(500).optional(),
    })
    .partial()
    .optional(),
});

const orderNoteBody = z.object({
  note: z.string().trim().min(1).max(2000),
});

const orderRefundBody = z.object({
  note: z.string().trim().max(500).optional(),
});

// ── Customers ──────────────────────────────────────────────────────────
const customerListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["all", "active", "blocked"]).optional(),
});

const customerBlockBody = z.object({
  blocked: z.boolean(),
});

// ── Categories ─────────────────────────────────────────────────────────
const categoryBody = z.object({
  slug: categoryEnum,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  banner: z.string().trim().url().max(500).optional().or(z.literal("")),
  image: z.string().trim().url().max(500).optional().or(z.literal("")),
  position: z.coerce.number().int().min(0).optional(),
  parent: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
  active: z.boolean().optional(),
});

const categoryUpdate = categoryBody.partial();

const categoryReorderBody = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1),
});

// Inventory patch — targeted stock update. Omitting `variantId` updates
// the parent product's stock; passing one updates that specific variant.
const inventoryUpdate = z.object({
  stock: z.coerce.number().int().min(0).max(1000000),
  variantId: objectId.optional(),
});

module.exports = {
  productBody,
  productUpdate,
  idParam,
  listQuery,
  orderListQuery,
  orderStatusUpdate,
  orderNoteBody,
  orderRefundBody,
  customerListQuery,
  customerBlockBody,
  categoryBody,
  categoryUpdate,
  categoryReorderBody,
  inventoryUpdate,
  CATEGORIES,
};
