require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const Database = require("better-sqlite3");
const multer = require("multer");

const app = express();

/* =========================
   PORT（Railway必須仕様）
========================= */
const PORT = process.env.PORT;

/* =========================
   ディレクトリ保証
========================= */
const uploadDir = path.join(__dirname, "public/uploads");
const dbDir = path.join(__dirname, "data");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

/* =========================
   SQLite
========================= */
const db = new Database(path.join(dbDir, "portfolio.db"));

db.prepare(`
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  category TEXT,
  year TEXT,
  statement TEXT,
  image TEXT
)
`).run();

/* =========================
   multer
========================= */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/uploads");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

/* =========================
   view / static
========================= */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* =========================
   session
========================= */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret-key",
    resave: false,
    saveUninitialized: false
  })
);

/* =========================
   auth
========================= */
function auth(req, res, next) {
  if (req.session.login) next();
  else res.redirect("/admin/login");
}

/* =========================
   routes
========================= */

app.get("/", (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works ORDER BY id DESC LIMIT 3"
  ).all();

  res.render("home", {
    concept: "作品／作者／鑑賞者の境界が崩れた後の実践を探る。",
    works
  });
});

app.get("/works", (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works ORDER BY id DESC"
  ).all();

  res.render("works", { works });
});

app.get("/works/:id", (req, res) => {
  const work = db.prepare(
    "SELECT * FROM works WHERE id = ?"
  ).get(req.params.id);

  res.render("work-detail", { work });
});

/* =========================
   admin
========================= */

app.get("/admin/login", (req, res) => {
  res.render("login");
});

app.post("/admin/login", (req, res) => {
  if (req.body.id === "admin" && req.body.pass === "1234") {
    req.session.login = true;
    res.redirect("/admin");
  } else {
    res.send("ログイン失敗");
  }
});

app.get("/admin", auth, (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works ORDER BY id DESC"
  ).all();

  res.render("admin", { works });
});

app.post("/admin/add", auth, upload.single("image"), (req, res) => {
  const filename = req.file ? req.file.filename : "";

  db.prepare(`
    INSERT INTO works (title, category, year, statement, image)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.body.title,
    req.body.category,
    req.body.year,
    req.body.statement,
    filename
  );

  res.redirect("/admin");
});

/* =========================
   start（重要）
========================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on", PORT);
});