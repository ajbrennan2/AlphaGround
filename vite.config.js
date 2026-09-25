import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    server: {
        port: 5173,
        ...(mode === "web-test" ? {
            proxy: {
                "/mock": {
                    target: `http://127.0.0.1:${process.env.MOCK_PORT ?? 3333}`,
                    ws: true,
                    rewrite: path => path.replace(/^\/mock/, ""),
                },
                "/bench": {
                    target: `http://127.0.0.1:${process.env.MOCK_PORT ?? 3333}`,
                    rewrite: path => path.replace(/^\/bench/, "") || "/",
                },
            },
        } : {}),
    },
    define: {
        "process.env.VITE_DEV_SERVER_URL":
            mode === "development"
                ? JSON.stringify("http://localhost:5173")
                : undefined,
    },
    base: "./", // ← crucial for Electron
}));
