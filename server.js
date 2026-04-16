require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const Database = require("better-sqlite3");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Directories
========================= */
const uploadDir = path.join(__dirname, "public", "uploads");
const dbDir = path.join(__dirname, "data");
const viewsDir = path.join(__dirname, "views");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

/* =========================
   DB
========================= */
const db = new Database(path.join(dbDir, "portfolio.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    slug TEXT,
    category TEXT NOT NULL DEFAULT '',
    year TEXT NOT NULL DEFAULT '',
    statement TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    coverImage TEXT NOT NULL DEFAULT '',
    orderIndex INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    passwordHash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin'
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn("works", "slug", "TEXT");
ensureColumn("works", "description", "TEXT NOT NULL DEFAULT ''");
ensureColumn("works", "image", "TEXT NOT NULL DEFAULT ''");
ensureColumn("works", "coverImage", "TEXT NOT NULL DEFAULT ''");
ensureColumn("works", "orderIndex", "INTEGER NOT NULL DEFAULT 0");

const defaults = {
  homeConcept: "作品／作者／鑑賞者の境界が崩れた後の実践を探る。",
  aboutProfile: "",
  aboutStatement: "",
  contactEmail: "",
  snsLinks: "[]"
};

const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)
`);
for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

const userCount = db.prepare(`SELECT COUNT(*) AS count FROM users`).get().count;
if (userCount === 0) {
  const username = (process.env.ADMIN_USERNAME || "admin").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim() || null;
  const password = (process.env.ADMIN_PASSWORD || "1234").trim();
  const passwordHash = require("bcrypt").hashSync(password, 12);

  db.prepare(`
    INSERT INTO users (username, email, passwordHash, role)
    VALUES (?, ?, ?, ?)
  `).run(username, email, passwordHash, "admin");
}

/* =========================
   Helpers
========================= */
function cleanText(value) {
  return String(value ?? "").trim();
}

function parseSnsLinks(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        label: cleanText(item?.label),
        url: cleanText(item?.url),
      }))
      .filter((item) => item.label && item.url);
  } catch {
    return [];
  }
}

function formatSnsLinksForTextarea(links) {
  return links.map((item) => `${item.label} | ${item.url}`).join("\n");
}

function getSettings() {
  const rows = db.prepare(`SELECT key, value FROM site_settings`).all();
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  const homeConcept = map.homeConcept || defaults.homeConcept;
  const aboutProfile = map.aboutProfile || defaults.aboutProfile;
  const aboutStatement = map.aboutStatement || defaults.aboutStatement;
  const contactEmail = map.contactEmail || defaults.contactEmail;
  const snsLinks = parseSnsLinks(map.snsLinks || defaults.snsLinks);

  return {
    homeConcept,
    aboutProfile,
    aboutStatement,
    contactEmail,
    snsLinks,
    snsLinksText: formatSnsLinksForTextarea(snsLinks),
  };
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO site_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value ?? ""));
}

function slugBase(title) {
  const raw = cleanText(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || `work-${Date.now()}`;
}

function uniqueSlug(title, ignoreId = null) {
  const base = slugBase(title);
  let candidate = base;
  let i = 1;

  while (true) {
    const row = ignoreId
      ? db.prepare(`SELECT id FROM works WHERE slug = ? AND id != ? LIMIT 1`).get(candidate, ignoreId)
      : db.prepare(`SELECT id FROM works WHERE slug = ? LIMIT 1`).get(candidate);

    if (!row) return candidate;
    candidate = `${base}-${i++}`;
  }
}

function getUploadedFilename(req) {
  const file =
    req.files?.image?.[0] ||
    req.files?.coverImage?.[0] ||
    req.file ||
    null;

  return file ? file.filename : "";
}

function removeUploadedFile(filename) {
  const safeName = cleanText(filename);
  if (!safeName) return;
  const fullPath = path.join(uploadDir, path.basename(safeName));
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

const WORK_SELECT_SQL = `
  SELECT
    id,
    title,
    slug,
    category,
    year,
    statement,
    description,
    COALESCE(NULLIF(coverImage, ''), image, '') AS coverImage,
    COALESCE(NULLIF(image, ''), coverImage, '') AS image,
    orderIndex
  FROM works
`;

function fetchWorks({ where = "", params = [], limit = "" } = {}) {
  const sql = `${WORK_SELECT_SQL} ${where} ORDER BY orderIndex ASC, id DESC ${limit}`;
  return db.prepare(sql).all(...params);
}

function getWorkByIdentifier(identifier) {
  const idOrSlug = cleanText(identifier);
  let work = db.prepare(`${WORK_SELECT_SQL} WHERE slug = ? LIMIT 1`).get(idOrSlug);
  if (work) return work;
  if (/^\d+$/.test(idOrSlug)) {
    work = db.prepare(`${WORK_SELECT_SQL} WHERE id = ? LIMIT 1`).get(Number(idOrSlug));
    if (work) return work;
  }
  return null;
}

function renderIfExists(res, views, locals = {}, status = 200) {
  const list = Array.isArray(views) ? views : [views];
  for (const view of list) {
    if (fs.existsSync(path.join(viewsDir, `${view}.ejs`))) {
      return res.status(status).render(view, locals);
    }
  }
  return res.status(404).render("404", { title: "404" });
}

function auth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/admin/login");
}

function normalizeOrderIndex(value) {
  const n = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
   multer
========================= */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${path.basename(file.originalname || "image")}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif"
    ]);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error("画像ファイルのみアップロードできます。"));
    }
    cb(null, true);
  }
});

const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "coverImage", maxCount: 1 }
]);

/* =========================
   Express
========================= */
app.set("view engine", "ejs");
app.set("views", viewsDir);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.categories = ["Painting", "Installation", "Text", "汀", "Zauberberg"];
  next();
});

/* =========================
   Public routes
========================= */
app.get("/", (req, res) => {
  const settings = getSettings();
  const works = fetchWorks({ limit: "LIMIT 3" });
  renderIfExists(res, ["home", "index"], { concept: settings.homeConcept, works, settings });
});

app.get("/works", (req, res) => {
  const category = cleanText(req.query.category);
  const works = category
    ? fetchWorks({ where: "WHERE category = ?", params: [category] })
    : fetchWorks();
  renderIfExists(res, ["works"], { works, activeCategory: category, categories: res.locals.categories });
});

app.get("/works/category/:name", (req, res) => {
  const category = cleanText(req.params.name);
  const works = fetchWorks({ where: "WHERE category = ?", params: [category] });
  renderIfExists(res, ["works"], { works, activeCategory: category, categories: res.locals.categories });
});

app.get("/works/:identifier", (req, res) => {
  const work = getWorkByIdentifier(req.params.identifier);
  if (!work) return res.status(404).render("404", { title: "404" });
  renderIfExists(res, ["work-detail", "work"], { work });
});

app.get("/about", (req, res) => {
  const settings = getSettings();
  renderIfExists(res, ["about"], {
    profile: settings.aboutProfile,
    statement: settings.aboutStatement,
    settings
  });
});

app.get("/contact", (req, res) => {
  const settings = getSettings();
  renderIfExists(res, ["contact"], {
    email: settings.contactEmail,
    snsLinks: settings.snsLinks,
    settings
  });
});

/* English routes */
app.get("/en", (req, res) => {
  const works = fetchWorks({ limit: "LIMIT 3" });
  renderIfExists(res, ["home-en", "home_en"], { works });
});

app.get("/en/works", (req, res) => {
  const works = fetchWorks();
  renderIfExists(res, ["works-en", "works_en"], { works, categories: res.locals.categories });
});

app.get("/en/about", (req, res) => {
  renderIfExists(res, ["about-en", "about_en"], {});
});

app.get("/en/contact", (req, res) => {
  const settings = getSettings();
  renderIfExists(res, ["contact-en", "contact_en"], {
    email: settings.contactEmail,
    snsLinks: settings.snsLinks
  });
});

/* =========================
   Auth
========================= */
app.get("/admin/login", (req, res) => {
  if (req.session.user) return res.redirect("/admin");
  renderIfExists(res, ["login", "admin/login"], { error: null });
});

app.post("/admin/login", (req, res) => {
  const bcrypt = require("bcrypt");
  const loginId = cleanText(req.body.id || req.body.username || req.body.email);
  const password = String(req.body.pass || req.body.password || "");

  const user = db.prepare(`
    SELECT * FROM users
    WHERE LOWER(username) = LOWER(?)
       OR LOWER(COALESCE(email, '')) = LOWER(?)
    LIMIT 1
  `).get(loginId, loginId);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return renderIfExists(res, ["login", "admin/login"], { error: "ログイン情報が違います。" }, 401);
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
  req.session.save(() => res.redirect("/admin"));
});

app.post("/admin/logout", auth, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

/* =========================
   Admin
========================= */
app.get("/admin", auth, (req, res) => {
  const settings = getSettings();
  const works = fetchWorks();
  renderIfExists(res, ["admin", "dashboard"], { works, settings });
});

app.get("/admin/settings", auth, (req, res) => {
  const settings = getSettings();
  renderIfExists(res, ["admin/settings", "settings"], settings);
});

app.post("/admin/settings", auth, (req, res) => {
  setSetting("homeConcept", cleanText(req.body.homeConcept));
  setSetting("aboutProfile", cleanText(req.body.aboutProfile));
  setSetting("aboutStatement", cleanText(req.body.aboutStatement));
  setSetting("contactEmail", cleanText(req.body.contactEmail));

  const snsLinks = String(req.body.snsLinks || "")
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => cleanText(part));
      if (parts.length < 2) return null;
      return { label: parts[0], url: parts.slice(1).join(" | ") };
    })
    .filter(Boolean);

  setSetting("snsLinks", JSON.stringify(snsLinks));
  res.redirect("/admin/settings");
});

app.get("/admin/works/new", auth, (req, res) => {
  renderIfExists(res, ["admin/work-form", "work-form", "edit"], {
    formTitle: "作品を追加",
    action: "/admin/works",
    buttonText: "作成",
    work: {
      title: "",
      slug: "",
      category: "Painting",
      year: "",
      statement: "",
      description: "",
      coverImage: "",
      image: "",
      orderIndex: 0,
    },
    categories: res.locals.categories
  });
});

function createWork(req, res) {
  const title = cleanText(req.body.title);
  const category = cleanText(req.body.category);
  const year = cleanText(req.body.year);
  const statement = cleanText(req.body.statement);
  const description = cleanText(req.body.description);
  const orderIndex = normalizeOrderIndex(req.body.orderIndex);
  const filename = getUploadedFilename(req);

  if (!title) return res.status(400).send("タイトルは必須です。");
  const slug = uniqueSlug(title);

  db.prepare(`
    INSERT INTO works (title, slug, category, year, statement, description, coverImage, image, orderIndex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, slug, category, year, statement, description, filename, filename, orderIndex);

  res.redirect("/admin");
}

app.post("/admin/works", auth, uploadFields, createWork);
app.post("/admin/add", auth, uploadFields, createWork);

function updateWork(req, res) {
  const existing = getWorkByIdentifier(req.params.identifier);
  if (!existing) return res.status(404).render("404", { title: "404" });

  const title = cleanText(req.body.title) || existing.title;
  const category = cleanText(req.body.category) || existing.category;
  const year = cleanText(req.body.year) || existing.year;
  const statement = cleanText(req.body.statement) || existing.statement;
  const description = cleanText(req.body.description) || existing.description;
  const orderIndex = normalizeOrderIndex(req.body.orderIndex ?? existing.orderIndex);

  const uploadedFilename = getUploadedFilename(req);
  const currentFilename = cleanText(existing.coverImage || existing.image);
  const finalFilename = uploadedFilename || currentFilename;

  if (uploadedFilename && currentFilename && uploadedFilename !== currentFilename) {
    removeUploadedFile(currentFilename);
  }

  const slug = existing.slug || uniqueSlug(title, existing.id);

  db.prepare(`
    UPDATE works
    SET title=?, slug=?, category=?, year=?, statement=?, description=?, coverImage=?, image=?, orderIndex=?
    WHERE id=?
  `).run(
    title,
    slug,
    category,
    year,
    statement,
    description,
    finalFilename,
    finalFilename,
    orderIndex,
    existing.id
  );

  res.redirect("/admin");
}

app.get("/admin/works/:identifier/edit", auth, (req, res) => {
  const work = getWorkByIdentifier(req.params.identifier);
  if (!work) return res.status(404).render("404", { title: "404" });

  renderIfExists(res, ["admin/work-form", "work-form", "edit"], {
    formTitle: "作品を編集",
    action: `/admin/works/${work.id}`,
    buttonText: "更新",
    work,
    categories: res.locals.categories
  });
});

app.post("/admin/works/:identifier", auth, uploadFields, updateWork);
app.post("/admin/edit/:identifier", auth, uploadFields, updateWork);

function deleteWork(req, res) {
  const work = getWorkByIdentifier(req.params.identifier);
  if (!work) return res.redirect("/admin");

  const filename = cleanText(work.coverImage || work.image);
  if (filename) removeUploadedFile(filename);

  db.prepare(`DELETE FROM works WHERE id = ?`).run(work.id);
  res.redirect("/admin");
}

app.get("/admin/delete/:identifier", auth, deleteWork);
app.get("/admin/works/:identifier/delete", auth, deleteWork);
app.post("/admin/delete/:identifier", auth, deleteWork);
app.post("/admin/works/:identifier/delete", auth, deleteWork);

/* =========================
   404 / error
========================= */
app.use((req, res) => {
  res.status(404).render("404", { title: "404" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(err.message || "Internal Server Error");
});

/* =========================
   Start
========================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);
});