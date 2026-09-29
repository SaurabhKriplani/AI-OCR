🔍 AI-OCR
Intelligent Product Label Extraction using OCR + LLM

AI-OCR is an end-to-end OCR application that extracts useful information from product-label images using PaddleOCR and Qwen2.5-Instruct.

Instead of returning only raw OCR text, the system processes the extracted text and converts it into structured product information.

✨ Features
🔎 OCR-based text extraction using PaddleOCR
🤖 LLM-powered information extraction using Qwen2.5-Instruct
🧹 OCR text cleaning and correction
📦 Extraction of 10+ product attributes
💰 MRP and currency extraction
⚖️ Net quantity and unit extraction
📅 Manufacturing and expiry/best-before date extraction
🏭 Manufacturer and address extraction
☎️ Customer-care information extraction
🌍 Country-of-origin extraction
📊 Structured JSON output
🌐 Full-stack web interface
🧠 Extracted Information

The system can identify fields such as:

Manufacturer
Address
Product Name
Net Quantity
MRP
Manufacturing Date
Best Before / Expiry
Customer Care
Country of Origin
🏗️ Architecture
React Frontend
       │
       ▼
Node.js + Express
       │
       ▼
FastAPI ML API
       │
       ├── PaddleOCR
       │
       └── Qwen2.5-Instruct
       │
       ▼
Structured JSON
       │
       ▼
React Frontend
🛠️ Tech Stack
Frontend
React
Vite
CSS
Backend
Node.js
Express.js
Axios
Multer
CORS
AI / ML
Python
FastAPI
PaddleOCR
Qwen2.5-Instruct
LangChain
Hugging Face
Deployment
Vercel
Render
📁 Project Structure
AI-OCR/
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── server.js
│   └── package.json
│
├── ml-api/
│   ├── app.py
│   ├── model.py
│   ├── requirements.txt
│   └── .gitignore
│
└── README.md
⚙️ How It Works
User uploads a product-label image through the React frontend.
The image is sent to the Node.js backend.
Node.js forwards the image to the FastAPI ML service.
PaddleOCR extracts the text from the image.
The extracted text is cleaned and processed.
Qwen2.5-Instruct identifies relevant product information.
The ML API returns structured JSON.
The React frontend displays the extracted information.
🚀 Local Setup
Clone the repository
git clone https://github.com/SaurabhKriplani/AI-OCR.git
cd AI-OCR
Frontend
cd frontend
npm install
npm run dev
Backend
cd backend
npm install
node server.js
ML API
cd ml-api
python -m venv .venv

Activate the environment.

Windows:

.venv\Scripts\Activate.ps1

Install dependencies:

pip install -r requirements.txt

Create a .env file:

HF_TOKEN=your_huggingface_token

Start the API:

python -m uvicorn app:app --reload
🔐 Environment Variables
ML API
HF_TOKEN=your_huggingface_token
Backend
ML_API_URL=your_ml_api_url

⚠️ Never commit .env files or API tokens to GitHub.

🔌 API
POST /extract-text

Accepts an image using multipart/form-data.

Field:

image: <image-file>

Example response:

{
  "success": true,
  "raw_text": "...",
  "cleaned_text": "...",
  "entities": {}
}
🌐 Live Demo

🚀 Live Application:
https://ai-ocr-gamma.vercel.app/

📂 GitHub Repository:
https://github.com/SaurabhKriplani/AI-OCR

🔮 Future Improvements
Multilingual OCR support
Batch image processing
Better handling of low-quality images
Confidence visualization
Downloadable extraction reports
Additional product-label formats
Inference optimization
👨‍💻 Author

Saurabh Kriplani

Artificial Intelligence & Data Engineering

GitHub
LinkedIn

⭐ If you find this project useful, consider giving it a star!
