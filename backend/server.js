const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const cors = require("cors");

const app = express();
const PORT = 5000;

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

            console.log("\n==============================");
            console.log("IMAGE RECEIVED BY NODE");
            console.log("==============================");
            console.log("Filename:", req.file.originalname);
            console.log("Size:", req.file.size);

            // Create form data for Python
            const formData = new FormData();

            formData.append(
                "file",
                req.file.buffer,
                {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                }
            );

            console.log("\nSending image to Python...");

            // Send image to FastAPI
            const response = await axios.post(
                "http://127.0.0.1:8000/extract-text",
                formData,
                {
                    headers: {
                        ...formData.getHeaders()
                    }
                }
            );

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

            res.status(500).json({
                success: false,
                error:
                    error.response?.data?.error ||
                    error.message ||
                    "Failed to extract text"
            });
        }
    }
);

// Start server
app.listen(PORT, () => {
    console.log(
        `Node backend running on http://localhost:${PORT}`
    );
});