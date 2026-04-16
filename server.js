require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const Database = require("better-sqlite3");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

/* DB */
const db = new Database("portfolio.db");

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
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, "public/uploads");
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: false
  })
);

/* 認証 */
function auth(req, res, next) {
  if (req.session.login) {
    next();
  } else {
    res.redirect("/admin/login");
  }
}

/* 公開ページ */

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
  const works = db.prepare("SELECT * FROM works ORDER BY id DESC").all();
  res.render("works", { works });
});

app.get("/works/category/:name", (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works WHERE category = ? ORDER BY id DESC"
  ).all(req.params.name);

  res.render("works", { works });
});

app.get("/works/:id", (req, res) => {
  const work = db.prepare(
    "SELECT * FROM works WHERE id = ?"
  ).get(req.params.id);

  res.render("work-detail", { work });
});

app.get("/about", (req, res) => {
  res.render("about");
});

app.get("/contact", (req, res) => {
  res.render("contact");
});

/* ログイン */

app.get("/admin/login", (req, res) => {
  res.render("login");
});

app.post("/admin/login", (req, res) => {
  if (
    req.body.id === "admin" &&
    req.body.pass === "1234"
  ) {
    req.session.login = true;
    res.redirect("/admin");
  } else {
    res.send("ログイン失敗");
  }
});

/* 管理画面 */

app.get("/admin", auth, (req, res) => {
  const works = db.prepare("SELECT * FROM works ORDER BY id DESC").all();
  res.render("admin", { works });
});

app.post("/admin/add", auth, upload.single("image"), (req, res) => {
  const filename = req.file ? req.file.filename : "";

  db.prepare(`
    INSERT INTO works
    (title, category, year, statement, image)
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

/* 削除 */
app.get("/admin/delete/:id", auth, (req, res) => {
  db.prepare("DELETE FROM works WHERE id = ?")
    .run(req.params.id);

  res.redirect("/admin");
});

/* 編集画面 */
app.get("/admin/edit/:id", auth, (req, res) => {
  const work = db.prepare(
    "SELECT * FROM works WHERE id = ?"
  ).get(req.params.id);

  res.render("edit", { work });
});

/* 編集保存 */
app.post("/admin/edit/:id", auth, (req, res) => {
  db.prepare(`
    UPDATE works
    SET title=?,
        category=?,
        year=?,
        statement=?
    WHERE id=?
  `).run(
    req.body.title,
    req.body.category,
    req.body.year,
    req.body.statement,
    req.params.id
  );

  res.redirect("/admin");
});

/* English pages */

app.get("/en", (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works ORDER BY id DESC LIMIT 3"
  ).all();

  res.render("home-en", { works });
});

app.get("/en/about", (req, res) => {
  res.render("about-en");
});

app.get("/en/contact", (req, res) => {
  res.render("contact-en");
});

app.get("/en/works", (req, res) => {
  const works = db.prepare(
    "SELECT * FROM works ORDER BY id DESC"
  ).all();

  res.render("works-en", { works });
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});