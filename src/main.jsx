import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
// Design previews are isolated from the board connection and live controls.
const App = lazy(() => new URLSearchParams(window.location.search).has("design")
    ? import("./designs/DesignPreview.jsx")
    : import("./App.jsx"));

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <Suspense fallback={<p role="status">Loading Alpha Ground…</p>}>
            <App />
        </Suspense>
    </StrictMode>
);
