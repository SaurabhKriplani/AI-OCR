import threading
import time

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware


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


# --------------------------------------------------
# Lazy model loading in a background thread
#
# Instead of importing model.py at the top (which blocks
# for 2-4 minutes while PaddleOCR downloads its models),
# we import it in a background thread so that:
#   - /healthz responds instantly (seconds after boot)
#   - /ready tells Node when models are actually ready
#   - The first real OCR request waits gracefully
# --------------------------------------------------

_extract_text_fn = None   # set once models are loaded
_models_ready    = False
_models_error    = None
_load_start      = time.time()


def _load_models():
    global _extract_text_fn, _models_ready, _models_error
    try:
        print("[Startup] Loading models in background thread...")
        from model import extract_text          # ← this triggers PaddleOCR download
        _extract_text_fn = extract_text
        _models_ready    = True
        elapsed = round(time.time() - _load_start, 1)
        print(f"[Startup] ✅ Models ready after {elapsed}s")
    except Exception as e:
        _models_error = str(e)
        print(f"[Startup] ❌ Model load failed: {e}")


# Kick off background loading immediately at startup
threading.Thread(target=_load_models, daemon=True).start()


# --------------------------------------------------
# Routes
# --------------------------------------------------

@app.api_route("/", methods=["GET", "HEAD"])
def home():
    return {"message": "AI OCR API is running"}


@app.api_route("/healthz", methods=["GET", "HEAD"])
def health_check():
    # Always 200 — just proves the process is alive.
    # Node backend polls this to confirm Render woke up.
    return {"status": "healthy"}


@app.api_route("/ready", methods=["GET", "HEAD"])
def ready_check():
    """
    Returns 200 only when models are fully loaded and ready to serve.
    Returns 503 while still loading, 500 if loading failed.
    Node backend polls this after /healthz passes.
    """
    if _models_error:
        raise HTTPException(status_code=500, detail=f"Model load failed: {_models_error}")

    if not _models_ready:
        elapsed = round(time.time() - _load_start, 1)
        raise HTTPException(
            status_code=503,
            detail=f"Models still loading ({elapsed}s elapsed). Please wait."
        )

    return {"ready": True}


@app.post("/extract-text")
async def extract_text_api(
    file: UploadFile = File(...)
):
    # If models are still loading, wait in place (up to 120s) rather than
    # failing immediately — handles the case where Node skips /ready polling.
    waited = 0
    while not _models_ready and not _models_error and waited < 120:
        time.sleep(2)
        waited += 2

    if _models_error:
        return {"success": False, "error": f"Model load failed: {_models_error}"}

    if not _models_ready:
        return {"success": False, "error": "Models are still loading. Please try again in 30 seconds."}

    try:
        image_bytes = await file.read()

        print(f"\nReceived image: {file.filename}")

        result = _extract_text_fn(image_bytes)

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