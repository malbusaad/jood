import { Route, Routes } from "react-router";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import PlaceholderPage from "./pages/PlaceholderPage";
import NotFoundPage from "./pages/NotFoundPage";
import { publicPages } from "./routes";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        {publicPages
          .filter((p) => p.path !== "/")
          .map((p) => (
            <Route key={p.path} path={p.path.slice(1)} element={<PlaceholderPage title={p.label} />} />
          ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
