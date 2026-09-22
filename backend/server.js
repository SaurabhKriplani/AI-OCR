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

// Sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll Python /healthz until it responds 200 or timeout
const waitForPythonAlive = async (cleanMlUrl, timeoutMs = 120000) => {
    const start = Date.now();
    let attempt = 0;

    while (Date.now() - start < timeoutMs) {
        attempt++;
        try {
            const resp = await axios.get(`${cleanMlUrl}/healthz`, { timeout: 8000 });
            if (resp.status === 200) {
                console.log(`[Warmup] Python ML alive after ${Math.round((Date.now() - start) / 1000)}s (attempt ${attempt})`);
                return true;
            }
        } catch (_) {
            // still booting
        }
        const wait = Math.min(5000 + attempt * 1000, 10000);
        console.log(`[Warmup] Python ML not ready yet (attempt ${attempt}). Waiting ${wait / 1000}s...`);
        await sleep(wait);
    }
    return false;
};

// Send the actual image to Python /extract-text.
// Retries up to maxRetries times if Render returns a 502/503 or non-JSON body,
// which can happen for a few seconds after healthz first passes.
const callExtractText = async (cleanMlUrl, fileBuffer, originalname, mimetype, maxRetries = 3) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`\n[Extract] Attempt ${attempt}/${maxRetries} — sending image to Python...`);

            const formData = new FormData();
            formData.append("file", fileBuffer, {
                filename: originalname,
                contentType: mimetype
            });

            const response = await axios.post(`${cleanMlUrl}/extract-text`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 120000,
                validateStatus: () => true   // handle all status codes manually
            });

            const contentType = response.headers["content-type"] || "";
            const isJson = contentType.includes("application/json");

            // 502 / 503 from Render nginx — service still stabilizing, retry
            if (response.status === 502 || response.status === 503) {
                console.log(`[Extract] Got HTTP ${response.status} (Render proxy not ready). Waiting 5s before retry...`);
                lastError = new Error(`HTTP ${response.status} from ML service`);
                await sleep(5000);
                continue;
            }

            // Non-JSON body — Render returned an error page
            if (!isJson) {
                console.log(`[Extract] Got non-JSON response (status ${response.status}). Waiting 5s before retry...`);
                lastError = new Error(`Non-JSON response from ML service (HTTP ${response.status})`);
                await sleep(5000);
                continue;
            }

            // Successful JSON response (even if success:false from Python, that's valid)
            console.log(`[Extract] Got valid JSON response on attempt ${attempt}`);
            return response.data;

        } catch (err) {
            console.log(`[Extract] Attempt ${attempt} threw: ${err.message}`);
            lastError = err;
            if (attempt < maxRetries) await sleep(5000);
        }
    }

    // All retries exhausted
    throw lastError || new Error("Failed to reach ML service after multiple attempts");
};

// Sanitize error — never forward raw HTML to the client
const sanitizeError = (err) => {
    const rawData = err.response?.data;

    // If data is a string that looks like HTML, return a clean message
    if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
        const status = err.response?.status;
        if (status === 502 || status === 503) {
            return "The AI service is still warming up. Please wait 15 seconds and try again.";
        }
        return `ML service returned an unexpected response (HTTP ${status || "unknown"}).`;
    }

    if (rawData?.error) return rawData.error;
    return err.message || "Failed to extract text";
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

    console.log("\n[Warmup] Pinging Python ML service...");
    const alive = await waitForPythonAlive(cleanMlUrl);

    if (alive) {
        return res.json({ ready: true });
    } else {
        return res.status(503).json({ ready: false, error: "ML service did not respond within timeout" });
    }
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

            // Step 1: Wait for Python app to boot (healthz polling)
            const pingOk = await waitForPythonAlive(cleanMlUrl, 120000);
            if (!pingOk) {
                return res.status(503).json({
                    success: false,
                    error: "The AI ML service took too long to wake up. Please try again."
                });
            }

            // Step 2: Give Render nginx a moment to sync after boot
            // (healthz can pass 2-3 seconds before nginx routes app traffic cleanly)
            console.log("[Extract] Waiting 3s for Render nginx to stabilize...");
            await sleep(3000);

            // Step 3: Send the real image — auto-retries on 502/non-JSON (up to 3x)
            const data = await callExtractText(
                cleanMlUrl,
                req.file.buffer,
                req.file.originalname,
                req.file.mimetype,
                3
            );

            console.log("\n==============================");
            console.log("RESPONSE FROM PYTHON");
            console.log("==============================");
            console.log(JSON.stringify(data, null, 2));
            console.log("\nSending response to React...");

            res.status(200).json(data);

        } catch (error) {
            console.error("\n==============================");
            console.error("OCR ERROR");
            console.error("==============================");
            console.error(error.response?.data || error.message);

            const cleanError = sanitizeError(error);

            res.status(500).json({
                success: false,
                error: cleanError
            });
        }
    }
);

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;