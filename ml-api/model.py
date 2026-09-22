import os
import io
import re
import json

import numpy as np
from PIL import Image
from dotenv import load_dotenv

# --------------------------------------------------
# Environment
# --------------------------------------------------

load_dotenv()

os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["FLAGS_enable_pir_api"] = "0"

# --------------------------------------------------
# PaddleOCR
# --------------------------------------------------

from paddleocr import PaddleOCR

print("Loading PaddleOCR...")

ocr = PaddleOCR(
    lang="en",
    enable_mkldnn=False,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False
)

print("PaddleOCR loaded successfully!")


# --------------------------------------------------
# Qwen LLM
# --------------------------------------------------

from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from langchain_core.prompts import PromptTemplate


HF_TOKEN = os.getenv("HF_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")


# --------------------------------------------------
# LLM Prompt
# --------------------------------------------------

prompt = PromptTemplate(
    input_variables=["ocr_text"],
    template="""
You are an OCR post-processing and structured information
extraction system for packaged commodity labels in India.

The following text was extracted from an image using OCR.

OCR TEXT:
--------------------
{ocr_text}
--------------------

Your task is ONLY to normalize the OCR text and extract
structured product information.

IMPORTANT RULES:

1. Correct obvious OCR errors only when the intended text
   is clear.

2. Merge fragmented words when the intended word is clear.

3. DO NOT invent or guess missing information.

4. Preserve numerical values unless there is an obvious
   OCR error.

5. Preserve currency information.

6. Normalize:
   - Rs
   - Rs.
   - INR

   to:

   INR

7. Normalize units where possible.

8. Distinguish between:

   PRESENT:
   The declaration exists and a value was found.

   VALUE_MISSING:
   The declaration exists but its value could not be found.

   MISSING:
   The declaration itself is not present.

9. If information is uncertain, use null.

10. Return ONLY valid JSON.

Return exactly this structure:

{{
    "manufacturer": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "address": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "product_name": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "net_quantity": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null,
        "unit": null
    }},

    "mrp": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null,
        "currency": null
    }},

    "manufacturing_date": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "best_before": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "customer_care": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }},

    "country_of_origin": {{
        "status": "PRESENT | MISSING | VALUE_MISSING",
        "value": null
    }}
}}
"""
)

chain = None

if HF_TOKEN:
    try:
        print("Initializing Qwen LLM via HuggingFace...")
        llm = HuggingFaceEndpoint(
            repo_id="Qwen/Qwen2.5-7B-Instruct",
            task="text-generation",
            max_new_tokens=1000,
            temperature=0.0,
            huggingfacehub_api_token=HF_TOKEN
        )
        chat_model = ChatHuggingFace(llm=llm)
        chain = prompt | chat_model
        print("Qwen LLM configured successfully!")
    except Exception as e:
        print(f"Warning: Could not initialize HuggingFace LLM ({e}). Heuristic extractor will be used as fallback.")
        chain = None
else:
    print("Notice: No HF_TOKEN provided. Heuristic fallback will be used for structured extraction.")


# --------------------------------------------------
# OCR helpers
# --------------------------------------------------

def group_into_lines(ocr_data, y_threshold=15):

    lines = []

    for item in ocr_data:

        text = item["text"]
        x = item["x"]
        y = item["y"]

        placed = False

        for line in lines:

            if abs(line["y"] - y) <= y_threshold:

                line["words"].append(item)

                line["words"].sort(
                    key=lambda w: w["x"]
                )

                placed = True
                break

        if not placed:

            lines.append({
                "y": y,
                "words": [item]
            })

    lines.sort(key=lambda line: line["y"])

    return [
        " ".join(word["text"] for word in line["words"])
        for line in lines
    ]


def clean_text(text):

    # Normalize spaces
    text = re.sub(r"\s+", " ", text)

    # Currency normalization
    text = re.sub(
        r"\bRs\.?\b",
        "INR",
        text,
        flags=re.IGNORECASE
    )

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
# Call LLM / Fallback
# --------------------------------------------------

def extract_structured_data(cleaned_text):

    print("\n==============================")
    print("SENDING TEXT TO LLM")
    print("==============================")

    print(cleaned_text)

    # 1. Try LLM if configured
    if chain is not None:
        try:
            response = chain.invoke({
                "ocr_text": cleaned_text
            })

            # ChatHuggingFace returns AIMessage
            response_text = response.content.strip()

            print("\n==============================")
            print("RAW LLM RESPONSE")
            print("==============================")
            print(response_text)

            # Remove markdown code fences if model adds them
            if response_text.startswith("```json"):
                response_text = response_text[7:]
            elif response_text.startswith("```"):
                response_text = response_text[3:]

            if response_text.endswith("```"):
                response_text = response_text[:-3]

            response_text = response_text.strip()

            return json.loads(response_text)

        except Exception as e:
            print("\nLLM EXTRACTION ERROR (Falling back to heuristic extraction):", str(e))

    # 2. Heuristic fallback when LLM is unavailable or fails
    fallback_data = heuristic_fallback_entities(cleaned_text)
    return fallback_data


# --------------------------------------------------
# MAIN PIPELINE
# --------------------------------------------------

def extract_text(image_bytes):

    print("\n================================")
    print("STARTING AI OCR PIPELINE")
    print("================================")

    # ---------------------------------------------
    # 1. Convert image
    # ---------------------------------------------

    image = Image.open(
        io.BytesIO(image_bytes)
    ).convert("RGB")

    # Downscale high-resolution images to fit in Render free tier (512MB RAM) and prevent OOM kills
    MAX_DIM = 1200
    if max(image.size) > MAX_DIM:
        scale = MAX_DIM / max(image.size)
        new_w = int(image.size[0] * scale)
        new_h = int(image.size[1] * scale)
        print(f"Resizing high-res image from {image.size} to ({new_w}, {new_h}) to avoid memory crash...")
        image = image.resize((new_w, new_h), Image.Resampling.BILINEAR)

    image_array = np.array(image)

    # ---------------------------------------------
    # 2. PaddleOCR
    # ---------------------------------------------

    print("\nRunning PaddleOCR...")

    result = ocr.predict(image_array)

    ocr_data = []

    for res in result:

        texts = res["rec_texts"]
        scores = res["rec_scores"]
        polys = res["rec_polys"]

        for text, score, poly in zip(
            texts,
            scores,
            polys
        ):

            if float(score) < 0.3:
                continue

            x = int(np.min(poly[:, 0]))
            y = int(np.min(poly[:, 1]))

            ocr_data.append({
                "text": text,
                "score": float(score),
                "x": x,
                "y": y
            })

    print(
        f"OCR detected {len(ocr_data)} text segments"
    )

    # ---------------------------------------------
    # 3. Arrange OCR into lines
    # ---------------------------------------------

    lines = group_into_lines(
        ocr_data
    )

    raw_text = "\n".join(lines)

    print("\n==============================")
    print("RAW OCR TEXT")
    print("==============================")

    print(raw_text)

    # ---------------------------------------------
    # 4. Clean OCR text
    # ---------------------------------------------

    cleaned_lines = []

    for line in lines:

        cleaned_line = clean_text(line)

        if cleaned_line:
            cleaned_lines.append(cleaned_line)

    cleaned_text = "\n".join(
        cleaned_lines
    )

    print("\n==============================")
    print("CLEANED OCR TEXT")
    print("==============================")

    print(cleaned_text)

    # ---------------------------------------------
    # 5. Qwen LLM
    # ---------------------------------------------

    structured_data = extract_structured_data(
        cleaned_text
    )

    # ---------------------------------------------
    # 6. Return everything
    # ---------------------------------------------

    return {
        "raw_text": raw_text,
        "cleaned_text": cleaned_text,
        "entities": structured_data
    }