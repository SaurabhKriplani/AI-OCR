const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 5000;
const ML_API_URL = process.env.ML_API_URL;

// Enable CORS
app.use(cors());

// Store uploaded image in memory
const upload = multer({
    storage: multer.memoryStorage()
});

// -----------------------------------------------
// Helpers
// -----------------------------------------------

const getCleanMlUrl = () => {
    if (!ML_API_URL) return null;
    return ML_API_URL.replace(/\/+$/, "");
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Step 1: Poll /healthz until the process is alive (app started, but models may still be loading)
const waitForProcessAlive = async (cleanMlUrl, timeoutMs = 60000) => {
    const start = Date.now();
    let attempt = 0;

    while (Date.now() - start < timeoutMs) {
        attempt++;
        try {
            const resp = await axios.get(`${cleanMlUrl}/healthz`, { timeout: 6000 });
            if (resp.status === 200) {
                console.log(`[Boot] Python process alive after ${Math.round((Date.now() - start) / 1000)}s (attempt ${attempt})`);
                return true;
            }
        } catch (_) {
            // process not up yet
        }
        const wait = Math.min(4000 + attempt * 1000, 8000);
        console.log(`[Boot] Process not up yet (attempt ${attempt}). Waiting ${wait / 1000}s...`);
        await sleep(wait);
    }
    return false;
};

// Step 2: Poll /ready until PaddleOCR models are fully loaded
// This is separate from /healthz — the process is alive but models take 2-4 min to download.
const waitForModelsReady = async (cleanMlUrl, timeoutMs = 300000) => {
    const start = Date.now();
    let attempt = 0;

    while (Date.now() - start < timeoutMs) {
        attempt++;
        try {
            const resp = await axios.get(`${cleanMlUrl}/ready`, {
                timeout: 6000,
                validateStatus: () => true
            });
            if (resp.status === 200) {
                console.log(`[Models] Ready after ${Math.round((Date.now() - start) / 1000)}s (attempt ${attempt})`);
                return true;
            }
            // 503 = still loading (expected), 500 = model load failed
            if (resp.status === 500) {
                console.error("[Models] Model load failed on Python side:", resp.data?.detail);
                return false;
            }
        } catch (_) {
            // /ready endpoint not responding yet
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`[Models] Still loading (attempt ${attempt}, ${elapsed}s elapsed)...`);
        await sleep(8000);
    }
    return false;
};

// Step 3: Send actual image — retries on 502/503/non-JSON for up to 60s
const callExtractText = async (cleanMlUrl, fileBuffer, originalname, mimetype, timeLimitMs = 60000) => {
    const start = Date.now();
    let attempt = 0;
    let lastError = null;

    while (Date.now() - start < timeLimitMs) {
        attempt++;
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`\n[Extract] Attempt ${attempt} (${elapsed}s elapsed) — sending image to Python...`);

        try {
            const formData = new FormData();
            formData.append("file", fileBuffer, {
                filename: originalname,
                contentType: mimetype
            });

            const response = await axios.post(`${cleanMlUrl}/extract-text`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 120000,
                validateStatus: () => true
            });

            const contentType = response.headers["content-type"] || "";
            const isJson = contentType.includes("application/json");

            if (response.status === 502 || response.status === 503) {
                const remaining = Math.round((timeLimitMs - (Date.now() - start)) / 1000);
                console.log(`[Extract] HTTP ${response.status}. ${remaining}s remaining, retrying in 5s...`);
                lastError = new Error("The AI service is still warming up. Please wait and try again.");
                await sleep(5000);
                continue;
            }

            if (!isJson) {
                const remaining = Math.round((timeLimitMs - (Date.now() - start)) / 1000);
                console.log(`[Extract] Non-JSON (HTTP ${response.status}). ${remaining}s remaining, retrying in 5s...`);
                lastError = new Error("The AI service is still warming up. Please wait and try again.");
                await sleep(5000);
                continue;
            }

            console.log(`[Extract] ✅ Valid JSON response on attempt ${attempt}`);
            return response.data;

        } catch (err) {
            const remaining = Math.round((timeLimitMs - (Date.now() - start)) / 1000);
            console.log(`[Extract] Attempt ${attempt} error: ${err.message}. ${remaining}s remaining...`);
            lastError = err;
            if (Date.now() - start + 5000 < timeLimitMs) await sleep(5000);
        }
    }

    throw lastError || new Error("The AI service is still warming up. Please wait and try again.");
};

// Sanitize error — never forward raw HTML to the client
const sanitizeError = (err) => {
    const rawData = err.response?.data;
    if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
        const status = err.response?.status;
        if (status === 502 || status === 503) {
            return "The AI service is still warming up. Please wait and try again.";
        }
        return `ML service returned an unexpected response (HTTP ${status || "unknown"}).`;
    }
    if (rawData?.error) return rawData.error;
    return err.message || "Failed to extract text";
};

// -----------------------------------------------
// Keep-alive ping — runs every 14 minutes in the
// background to prevent Render from sleeping Python.
// -----------------------------------------------
const startKeepAlive = () => {
    const cleanMlUrl = getCleanMlUrl();
    if (!cleanMlUrl) return;

    setInterval(async () => {
        try {
            const resp = await axios.get(`${cleanMlUrl}/healthz`, { timeout: 8000 });
            console.log(`[Keep-alive] Pinged Python ML (status ${resp.status})`);
        } catch (err) {
            console.log(`[Keep-alive] Ping failed: ${err.message}`);
        }
    }, 14 * 60 * 1000); // every 14 minutes

    console.log("[Keep-alive] Scheduled Python ML ping every 14 minutes");
};

// -----------------------------------------------
// Routes
// -----------------------------------------------

app.get("/", (req, res) => {
    res.json({ message: "Node backend is running" });
});

// Warmup route
app.get("/api/warmup", async (req, res) => {
    const cleanMlUrl = getCleanMlUrl();
    if (!cleanMlUrl) {
        return res.status(500).json({ ready: false, error: "ML_API_URL not configured" });
    }

    console.log("\n[Warmup] Checking Python ML service...");

    // Step 1: Is the process alive?
    const alive = await waitForProcessAlive(cleanMlUrl, 60000);
    if (!alive) {
        return res.status(503).json({ ready: false, error: "ML service process did not start within timeout" });
    }

    // Step 2: Are models loaded?
    const ready = await waitForModelsReady(cleanMlUrl, 300000);
    if (!ready) {
        return res.status(503).json({ ready: false, error: "ML models did not finish loading within timeout" });
    }

    return res.json({ ready: true });
});

// OCR route
app.post(
    "/api/extract-text",
    upload.single("image"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: "No image uploaded" });
            }

            const cleanMlUrl = getCleanMlUrl();
            if (!cleanMlUrl) {
                return res.status(500).json({ success: false, error: "ML_API_URL environment variable is not configured" });
            }

            console.log("\n==============================");
            console.log("IMAGE RECEIVED BY NODE");
            console.log("==============================");
            console.log("Filename:", req.file.originalname);
            console.log("Size:", req.file.size);

            // Step 1: Wait for Python process to boot (fast — seconds)
            console.log("\n[Boot] Waiting for Python process...");
            const alive = await waitForProcessAlive(cleanMlUrl, 60000);
            if (!alive) {
                return res.status(503).json({
                    success: false,
                    error: "The AI service process did not start. Please try again."
                });
            }

            // Step 2: Wait for models to finish loading (slow — 2-4 minutes on cold start)
            console.log("\n[Models] Waiting for PaddleOCR models to load...");
            const ready = await waitForModelsReady(cleanMlUrl, 300000);
            if (!ready) {
                return res.status(503).json({
                    success: false,
                    error: "The AI models took too long to load. Please try again."
                });
            }

            // Step 3: Send image — brief retry window in case nginx is still syncing
            const data = await callExtractText(
                cleanMlUrl,
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype,
                60000
            );

            console.log("\n==============================");
            console.log("RESPONSE FROM PYTHON");
            console.log("==============================");
            console.log(JSON.stringify(data, null, 2));

            res.status(200).json(data);

        } catch (error) {
            console.error("\n==============================");
            console.error("OCR ERROR");
            console.error("==============================");
            console.error(error.response?.data || error.message);

            const cleanError = sanitizeError(error);
            res.status(500).json({ success: false, error: cleanError });
        }
    }
);

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    // Start keep-alive after 30s (give Python time to boot first)
    setTimeout(startKeepAlive, 30000);
});

module.exports = app;