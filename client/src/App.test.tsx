import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import App from "./App";
import { publicPages } from "./routes";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  it("renders the home page with booking call-to-action", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("استراحة الجود");
    expect(screen.getAllByRole("link", { name: "احجز الآن" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "استكشف الاستراحة" })).toBeInTheDocument();
  });

  it.each(publicPages.filter((p) => p.path !== "/"))("renders $label at $path", ({ path, label }) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(label);
  });

  it("renders a not-found page for unknown routes", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("الصفحة غير موجودة");
  });

  it("defines all ten public catalog pages", () => {
    expect(publicPages).toHaveLength(10);
  });
});
