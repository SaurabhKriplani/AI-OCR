import os
import io
import re
import json
import urllib.request
import urllib.error

import numpy as np
from PIL import Image
from dotenv import load_dotenv

# --------------------------------------------------
# Environment Flags (Disable slow network checks & heavy features)
# --------------------------------------------------

load_dotenv()

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ["PADDLE_PDX_DISABLE_UPDATE_CHECK"] = "True"
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"

# --------------------------------------------------
# PaddleOCR (Use lightweight PP-OCRv4 mobile model)
# --------------------------------------------------

from paddleocr import PaddleOCR

print("[Model] Loading lightweight PP-OCRv4 models...")

ocr = PaddleOCR(
    lang="en",
    ocr_version="PP-OCRv4",
    enable_mkldnn=False,
    use_angle_cls=False
)

print("[Model] PaddleOCR loaded successfully!")


# --------------------------------------------------
# API Keys
# --------------------------------------------------

HF_TOKEN = os.getenv("HF_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")


# --------------------------------------------------
# LLM Prompt Template
# --------------------------------------------------

SYSTEM_PROMPT = """You are an OCR post-processing and structured information extraction system for packaged commodity labels in India.

Return ONLY a single valid JSON object with no markdown fences, matching exactly this schema:
{
    "manufacturer": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "address": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "product_name": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "net_quantity": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null, "unit": null},
    "mrp": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null, "currency": null},
    "manufacturing_date": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "best_before": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "customer_care": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null},
    "country_of_origin": {"status": "PRESENT | MISSING | VALUE_MISSING", "value": null}
}

Rules:
1. Normalize currency to INR.
2. Do not invent missing data.
3. Use PRESENT, MISSING, or VALUE_MISSING for status."""


# --------------------------------------------------
# Lightweight HTTP LLM Invocation (Zero extra RAM)
# --------------------------------------------------

def query_llm_api(ocr_text):
    # 1. Try Groq if key exists (Fastest & most reliable)
    if GROQ_API_KEY:
        try:
            print("[LLM] Querying Groq API...")
            url = "https://api.groq.com/openai/v1/chat/completions"
            payload = json.dumps({
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"OCR TEXT:\n{ocr_text}"}
                ],
                "temperature": 0.0,
                "response_format": {"type": "json_object"}
            }).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json"
                },
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                return json.loads(content)
        except Exception as e:
            print(f"[LLM] Groq API call failed: {e}")

    # 2. Try Hugging Face Serverless API if HF_TOKEN exists
    if HF_TOKEN:
        try:
            print("[LLM] Querying Hugging Face API...")
            url = "https://api-inference.huggingface.co/models/Qwen/Qwen2.5-7B-Instruct/v1/chat/completions"
            payload = json.dumps({
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"OCR TEXT:\n{ocr_text}"}
                ],
                "max_tokens": 1000,
                "temperature": 0.0
            }).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Authorization": f"Bearer {HF_TOKEN}",
                    "Content-Type": "application/json"
                },
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                # Clean potential markdown
                content = re.sub(r"^```json\s*", "", content.strip())
                content = re.sub(r"\s*```$", "", content)
                return json.loads(content)
        except Exception as e:
            print(f"[LLM] HuggingFace API call failed: {e}")

    return None


# --------------------------------------------------
# OCR helpers
# --------------------------------------------------

def group_into_lines(ocr_data, y_threshold=15):
    lines = []
    for item in ocr_data:
        y = item["y"]
        placed = False
        for line in lines:
            if abs(line["y"] - y) <= y_threshold:
                line["words"].append(item)
                line["words"].sort(key=lambda w: w["x"])
                placed = True
                break
        if not placed:
            lines.append({"y": y, "words": [item]})

    lines.sort(key=lambda line: line["y"])
    return [" ".join(word["text"] for word in line["words"]) for line in lines]


def clean_text(text):
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\bRs\.?\b", "INR", text, flags=re.IGNORECASE)
    return text.strip()


# --------------------------------------------------
# Heuristic fallback extractor
# --------------------------------------------------

def heuristic_fallback_entities(text):
    entities = {
        "manufacturer": {"status": "MISSING", "value": None},
        "address": {"status": "MISSING", "value": None},
        "product_name": {"status": "MISSING", "value": None},
        "net_quantity": {"status": "MISSING", "value": None, "unit": None},
        "mrp": {"status": "MISSING", "value": None, "currency": None},
        "manufacturing_date": {"status": "MISSING", "value": None},
        "best_before": {"status": "MISSING", "value": None},
        "customer_care": {"status": "MISSING", "value": None},
        "country_of_origin": {"status": "MISSING", "value": None}
    }

    # Match MRP
    mrp_match = re.search(r"(?:MRP|PRICE|RS\.?|INR)\s*[:.]?\s*(\d+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if mrp_match:
        entities["mrp"] = {"status": "PRESENT", "value": mrp_match.group(1), "currency": "INR"}

    # Match Net Quantity
    qty_match = re.search(r"(?:NET\s*(?:QTY|QUANTITY|WT|WEIGHT)?)\s*[:.]?\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|gm|grams)?", text, re.IGNORECASE)
    if qty_match:
        entities["net_quantity"] = {
            "status": "PRESENT",
            "value": qty_match.group(1),
            "unit": qty_match.group(2) if qty_match.group(2) else None
        }

    # Match Country of Origin
    origin_match = re.search(r"(?:COUNTRY\s*OF\s*ORIGIN|MADE\s*IN)\s*[:.]?\s*([A-Za-z]+)", text, re.IGNORECASE)
    if origin_match:
        entities["country_of_origin"] = {"status": "PRESENT", "value": origin_match.group(1).title()}

    # Match Mfg Date
    mfd_match = re.search(r"(?:MFD|MFG|PKD|PACKED)\s*[:.]?\s*(\d{1,2}[/-]\d{2,4})", text, re.IGNORECASE)
    if mfd_match:
        entities["manufacturing_date"] = {"status": "PRESENT", "value": mfd_match.group(1)}

    # Match Best Before
    bb_match = re.search(r"(?:BEST\s*BEFORE|USE\s*BY|EXPIRY)\s*[:.]?\s*([^\n,]+)", text, re.IGNORECASE)
    if bb_match:
        entities["best_before"] = {"status": "PRESENT", "value": bb_match.group(1).strip()}

    # Match Customer Care
    care_match = re.search(r"(?:CUSTOMER\s*CARE|CONSUMER\s*CARE|HELPLINE|CALL)\s*[:.]?\s*([0-9\s-]{8,15})", text, re.IGNORECASE)
    if care_match:
        entities["customer_care"] = {"status": "PRESENT", "value": care_match.group(1).strip()}

    return entities


# --------------------------------------------------
# Structured extraction router
# --------------------------------------------------

def extract_structured_data(cleaned_text):
    print("\n[Extraction] Attempting LLM extraction...")
    llm_result = query_llm_api(cleaned_text)
    if llm_result and isinstance(llm_result, dict):
        print("[Extraction] ✅ Successfully extracted structured data via LLM")
        return llm_result

    print("[Extraction] Using heuristic fallback entity extractor...")
    return heuristic_fallback_entities(cleaned_text)


# --------------------------------------------------
# MAIN PIPELINE
# --------------------------------------------------

def extract_text(image_bytes):
    print("\n================================")
    print("STARTING AI OCR PIPELINE")
    print("================================")

    # 1. Convert image
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Downscale high-resolution images to fit in Render free tier (512MB RAM)
    MAX_DIM = 1200
    if max(image.size) > MAX_DIM:
        scale = MAX_DIM / max(image.size)
        new_w = int(image.size[0] * scale)
        new_h = int(image.size[1] * scale)
        print(f"Resizing high-res image from {image.size} to ({new_w}, {new_h})...")
        image = image.resize((new_w, new_h), Image.Resampling.BILINEAR)

    image_array = np.array(image)

    # 2. PaddleOCR
    print("\nRunning PaddleOCR...")
    result = ocr.ocr(image_array)

    ocr_data = []
    if result and len(result) > 0 and result[0] is not None:
        for line in result[0]:
            poly = np.array(line[0])
            text = line[1][0]
            score = line[1][1]

            if float(score) < 0.3:
                continue

            x = int(np.min(poly[:, 0]))
            y = int(np.min(poly[:, 1]))

            ocr_data.append({"text": text, "score": float(score), "x": x, "y": y})

    print(f"OCR detected {len(ocr_data)} text segments")

    # 3. Arrange OCR into lines
    lines = group_into_lines(ocr_data)
    raw_text = "\n".join(lines)

    # 4. Clean OCR text
    cleaned_lines = [clean_text(line) for line in lines if clean_text(line)]
    cleaned_text = "\n".join(cleaned_lines)

    # 5. LLM or Heuristic Extraction
    structured_data = extract_structured_data(cleaned_text)

    return {
        "raw_text": raw_text,
        "cleaned_text": cleaned_text,
        "entities": structured_data
    }