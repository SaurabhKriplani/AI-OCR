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

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Node backend is running"
    });
});

// OCR route
app.post(
    "/api/extract-text",
    upload.single("image"),
    async (req, res) => {

        try {

            // Check image
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: "No image uploaded"
                });
            }

            if (!ML_API_URL) {
                return res.status(500).json({
                    success: false,
                    error: "ML_API_URL environment variable is not configured"
                });
            }

            console.log("\n==============================");
            console.log("IMAGE RECEIVED BY NODE");
            console.log("==============================");
            console.log("Filename:", req.file.originalname);
            console.log("Size:", req.file.size);

            const cleanMlUrl = ML_API_URL.replace(/\/+$/, "");

            console.log("\nSending image to Python:", `${cleanMlUrl}/extract-text`);

            // Helper to post to Python with automatic retry on Render cold-starts
            const sendToPython = async (retriesLeft = 2) => {
                const formData = new FormData();
                formData.append("file", req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });

                try {
                    return await axios.post(`${cleanMlUrl}/extract-text`, formData, {
                        headers: {
                            ...formData.getHeaders()
                        },
                        timeout: 120000
                    });
                } catch (err) {
                    const status = err.response?.status;
                    const isColdStart = status === 502 || status === 503 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";

                    if (isColdStart && retriesLeft > 0) {
                        console.log(`\n[Python ML Service waking up (Status: ${status || err.code})]. Waiting 6s before retry (${retriesLeft} retries remaining)...`);
                        await new Promise((resolve) => setTimeout(resolve, 6000));
                        return await sendToPython(retriesLeft - 1);
                    }
                    throw err;
                }
            };

            const response = await sendToPython();

            console.log("\n==============================");
            console.log("RESPONSE FROM PYTHON");
            console.log("==============================");

            console.log(
                JSON.stringify(response.data, null, 2)
            );

            console.log("\nSending response to React...");

            // Send Python response directly to React
            res.status(200).json(response.data);

        } catch (error) {

            console.error("\n==============================");
            console.error("OCR ERROR");
            console.error("==============================");

            console.error(
                error.response?.data ||
                error.message
            );

            const status = error.response?.status;
            let userErrorMessage =
                error.response?.data?.error ||
                error.message ||
                "Failed to extract text";

            if (status === 502 || status === 503 || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
                userErrorMessage =
                    "The Python ML service on Render is waking up from sleep mode (Render free tier can take 60-90s on cold start). Please wait 30 seconds and try again.";
            }

            res.status(500).json({
                success: false,
                error: userErrorMessage
            });
        }
    }
);

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;