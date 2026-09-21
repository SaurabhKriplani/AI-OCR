from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from model import extract_text


app = FastAPI(
    title="AI OCR API",
    description="PaddleOCR + Qwen AI OCR API",
    version="1.0"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {
        "message": "AI OCR API is running"
    }


@app.post("/extract-text")
async def extract_text_api(
    file: UploadFile = File(...)
):

    try:

        image_bytes = await file.read()

        print(
            f"\nReceived image: {file.filename}"
        )

        result = extract_text(
            image_bytes
        )

        return {
            "success": True,
            "filename": file.filename,
            "raw_text": result["raw_text"],
            "cleaned_text": result["cleaned_text"],
            "entities": result["entities"]
        }

    except Exception as e:

        print("\nERROR:", str(e))

        return {
            "success": False,
            "error": str(e)
        }