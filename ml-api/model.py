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
    enable_mkldnn=False
)

print("PaddleOCR loaded successfully!")


# --------------------------------------------------
# Qwen LLM
# --------------------------------------------------

from langchain_huggingface import HuggingFaceEndpoint, ChatHuggingFace
from langchain_core.prompts import PromptTemplate


HF_TOKEN = os.getenv("HF_TOKEN")

if not HF_TOKEN:
    raise RuntimeError(
        "HF_TOKEN not found. Please add HF_TOKEN to .env"
    )


print("Loading Qwen LLM...")

llm = HuggingFaceEndpoint(
    repo_id="Qwen/Qwen2.5-72B-Instruct",
    task="text-generation",
    max_new_tokens=1000,
    temperature=0.0,
    huggingfacehub_api_token=HF_TOKEN
)

chat_model = ChatHuggingFace(
    llm=llm
)

print("Qwen LLM configured successfully!")


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

chain = prompt | chat_model


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
# Call Qwen
# --------------------------------------------------

def extract_structured_data(cleaned_text):

    print("\n==============================")
    print("SENDING TEXT TO QWEN LLM")
    print("==============================")

    print(cleaned_text)

    response = chain.invoke({
        "ocr_text": cleaned_text
    })

    # ChatHuggingFace returns AIMessage
    response_text = response.content

    print("\n==============================")
    print("RAW QWEN RESPONSE")
    print("==============================")

    print(response_text)

    # Remove markdown code fences if model adds them
    response_text = response_text.strip()

    if response_text.startswith("```json"):
        response_text = response_text[7:]

    elif response_text.startswith("```"):
        response_text = response_text[3:]

    if response_text.endswith("```"):
        response_text = response_text[:-3]

    response_text = response_text.strip()

    # Convert JSON string -> Python dictionary
    try:

        structured_data = json.loads(response_text)

    except json.JSONDecodeError as e:

        print("\nQWEN JSON PARSING ERROR:")
        print(e)

        structured_data = {
            "error": "Qwen returned invalid JSON",
            "raw_response": response_text
        }

    return structured_data


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