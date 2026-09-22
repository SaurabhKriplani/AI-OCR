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

// Poll Python health endpoint until it responds OK or timeout
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
            // still booting, wait and retry
        }
        const wait = Math.min(5000 + attempt * 1000, 10000); // 6s, 7s, 8s... max 10s
        console.log(`[Warmup] Python ML not ready yet (attempt ${attempt}). Waiting ${wait / 1000}s...`);
        await sleep(wait);
    }
    return false;
};

// After healthz passes, Render's nginx may still return 502 for a few seconds.
// This function verifies that the /extract-text endpoint is actually accepting
// requests by doing a lightweight probe — sending a tiny 1x1 white pixel PNG.
const waitForExtractReady = async (cleanMlUrl, timeoutMs = 30000) => {
    // Minimal valid 1x1 white PNG (67 bytes)
    const TINY_PNG = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
        "2e00000000c4944415478016360f8ff000000020001e221bc330000000049454e44ae426082",
        "hex"
    );

    const start = Date.now();
    let attempt = 0;

    while (Date.now() - start < timeoutMs) {
        attempt++;
        try {
            const probe = new FormData();
            probe.append("file", TINY_PNG, {
                filename: "probe.png",
                contentType: "image/png"
            });

            const resp = await axios.post(`${cleanMlUrl}/extract-text`, probe, {
                headers: { ...probe.getHeaders() },
                timeout: 10000,
                validateStatus: () => true   // don't throw on any HTTP status
            });

            const contentType = resp.headers["content-type"] || "";

            // If we get a JSON response (even a success:false), the service is ready
            if (contentType.includes("application/json") || resp.status === 200) {
                console.log(`[Probe] /extract-text ready after ${Math.round((Date.now() - start) / 1000)}s`);
                return true;
            }

            // Still getting HTML (502/503 proxy error from Render nginx)
            console.log(`[Probe] Got non-JSON response (status ${resp.status}), waiting...`);
        } catch (err) {
            console.log(`[Probe] /extract-text probe error: ${err.message}`);
        }

        await sleep(3000);
    }

    return false;
};

// Sanitize error — never forward raw HTML to the client
const sanitizeError = (err) => {
    const rawData = err.response?.data;

    // If data is a string and looks like HTML, replace with a clean message
    if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
        const status = err.response?.status;
        if (status === 502 || status === 503) {
            return "The AI service is still warming up. Please wait 15 seconds and try again.";
        }
        return `ML service returned an unexpected response (HTTP ${status || "unknown"}).`;
    }

    // If data is an object with an error field, use it
    if (rawData?.error) return rawData.error;

    // Fall back to axios message
    return err.message || "Failed to extract text";
};

// -----------------------------------------------
// Routes
// -----------------------------------------------

// Test route
app.get("/", (req, res) => {
    res.json({ message: "Node backend is running" });
});

// Warmup route — called by frontend before submitting image
// Pings Python ML service and waits up to 120 seconds for it to boot
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
            console.log("\nSending image to Python:", `${cleanMlUrl}/extract-text`);

            // Step 1: Wait for healthz to confirm Python app is booted
            const pingOk = await waitForPythonAlive(cleanMlUrl, 120000);
            if (!pingOk) {
                return res.status(503).json({
                    success: false,
                    error: "The AI ML service took too long to wake up. Please try again."
                });
            }

            // Step 2: Verify /extract-text endpoint is actually serving JSON
            // (Render nginx can return 502 for a few seconds even after healthz passes)
            console.log("\n[Probe] Verifying /extract-text is ready...");
            const extractReady = await waitForExtractReady(cleanMlUrl, 30000);
            if (!extractReady) {
                return res.status(503).json({
                    success: false,
                    error: "The AI service is initializing. Please wait 15 seconds and try again."
                });
            }

            // Step 3: Build FormData and call Python with the actual image
            const formData = new FormData();
            formData.append("file", req.file.buffer, {
                filename: req.file.originalname,
                contentType: req.file.mimetype
            });

            const response = await axios.post(`${cleanMlUrl}/extract-text`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: 120000
            });

            // Verify we got a real JSON response, not an HTML error page
            const contentType = response.headers["content-type"] || "";
            if (!contentType.includes("application/json")) {
                throw new Error("ML service returned non-JSON response. Please try again in 15 seconds.");
            }

            console.log("\n==============================");
            console.log("RESPONSE FROM PYTHON");
            console.log("==============================");
            console.log(JSON.stringify(response.data, null, 2));
            console.log("\nSending response to React...");

            res.status(200).json(response.data);

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