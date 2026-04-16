"use client";

import React, { useMemo, useState } from "react";

const works = [
  { title: "Painting 01", category: "Painting", year: "2026" },
  { title: "Installation 01", category: "Installation", year: "2025" },
  { title: "Text 01", category: "Text", year: "2026" },
  { title: "Migiwa", category: "Community", year: "2024–" },
];

const categories = ["All", "Painting", "Installation", "Text", "Community"];

export default function Page() {
  const [active, setActive] = useState("All");

  const filtered = useMemo(() => {
    if (active === "All") return works;
    return works.filter((w) => w.category === active);
  }, [active]);

  return (
    <main style={{ padding: 40, fontFamily: "sans-serif" }}>
      <div
  style={{
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 30,
    marginBottom: 40,
    alignItems: "center",
  }}
>
  <div>
    <h1 style={{ fontSize: 32 }}>
      Taichi Ichino Portfolio
    </h1>
    <p>
      Painting / Installation / Text / Community Practice
    </p>
  </div>

  <img
    src="/images/hero.jpg"
    style={{
      width: "100%",
      height: "400px",
      objectFit: "cover",
    }}
  />
</div>
      <h1 style={{ fontSize: 32, marginBottom: 20 }}>
        Taichi Ichino Portfolio
      </h1>

      <p style={{ marginBottom: 30 }}>
        Painting / Installation / Text / Community Practice
      </p>

      <div style={{ marginBottom: 30 }}>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            style={{
              marginRight: 10,
              marginBottom: 10,
              padding: "8px 14px",
              background: active === c ? "black" : "white",
              color: active === c ? "white" : "black",
              border: "1px solid black",
              cursor: "pointer",
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 20 }}>
        {filtered.map((w, i) => (
          <div
            key={i}
            style={{
              padding: 20,
              border: "1px solid #ccc",
            }}
          >
            <h2>{w.title}</h2>
            <p>{w.category}</p>
            <p>{w.year}</p>
          </div>
        ))}
      </div>
    </main>
  );
}