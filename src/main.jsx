import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
// Design previews are isolated from the board connection and live controls.
const design = new URLSearchParams(window.location.search).get("design");
const App = lazy(() => ['console', 'field', 'analysis'].includes(design)
    ? import("./designs/DesignPreview.jsx")
    : import("./App.jsx"));

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <Suspense fallback={<p role="status">Loading Alpha Ground…</p>}>
            <App />
        </Suspense>
    </StrictMode>
);
