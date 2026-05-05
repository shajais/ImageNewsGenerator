"""
Shashi Face Swap — HuggingFace Space
Powered by InsightFace buffalo_l + inswapper_128.onnx
Deployed at: https://huggingface.co/spaces/shajais/FaceSwap
"""

import os
import cv2
import numpy as np
import gradio as gr
import insightface
from insightface.app import FaceAnalysis
from insightface.model_zoo import get_model
from PIL import Image
import tempfile
import traceback

# ── Model init (runs once at cold start) ──────────────────────────────────────
print("Loading InsightFace models…")
FACE_ANALYSER = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
FACE_ANALYSER.prepare(ctx_id=0, det_size=(640, 640))

# inswapper_128 must be downloaded into the space or loaded from model hub
# Download once: https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx
SWAPPER_PATH = os.path.join(os.path.dirname(__file__), "inswapper_128.onnx")
if not os.path.exists(SWAPPER_PATH):
    print("Downloading inswapper_128.onnx from HuggingFace hub…")
    import urllib.request
    url = "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx"
    urllib.request.urlretrieve(url, SWAPPER_PATH)
    print("Download complete.")

SWAPPER = get_model(SWAPPER_PATH, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
print("InsightFace models loaded ✅")


# ── Core face-swap function ────────────────────────────────────────────────────
def swap_faces(source_img: np.ndarray, target_img: np.ndarray) -> np.ndarray:
    """Swap all detected faces in target_img with the face from source_img."""
    src_faces = FACE_ANALYSER.get(source_img)
    if not src_faces:
        raise ValueError("No face detected in source (face photo) image.")
    src_face = sorted(src_faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]

    tgt_faces = FACE_ANALYSER.get(target_img)
    if not tgt_faces:
        raise ValueError("No face detected in target image.")

    result = target_img.copy()
    for tgt_face in tgt_faces:
        result = SWAPPER.get(result, tgt_face, src_face, paste_back=True)
    return result


# ── PIL helper ─────────────────────────────────────────────────────────────────
def pil_to_bgr(pil_img):
    return cv2.cvtColor(np.array(pil_img.convert("RGB")), cv2.COLOR_RGB2BGR)

def bgr_to_pil(bgr):
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


# ── Gradio handler ─────────────────────────────────────────────────────────────
def gradio_swap(source_pil, target_pil):
    try:
        if source_pil is None:
            return None, "❌ Please upload a face photo (source)."
        if target_pil is None:
            return None, "❌ Please upload the target image."

        src_bgr = pil_to_bgr(source_pil)
        tgt_bgr = pil_to_bgr(target_pil)

        result_bgr = swap_faces(src_bgr, tgt_bgr)
        result_pil = bgr_to_pil(result_bgr)
        return result_pil, "✅ Face swap complete!"
    except Exception as e:
        traceback.print_exc()
        return None, f"❌ Error: {str(e)}"


# ── Gradio UI ──────────────────────────────────────────────────────────────────
with gr.Blocks(
    title="Shashi Face Swap",
    theme=gr.themes.Soft(primary_hue="purple"),
    css="""
    .gradio-container { max-width: 900px; margin: auto; }
    .disclaimer { font-size: 0.75rem; color: #888; padding: 8px 12px;
                  border: 1px solid #444; border-radius: 8px; margin-top: 8px; }
    """
) as demo:
    gr.Markdown("""
    # 🎭 Shashi Face Swap
    **Powered by InsightFace buffalo_l + inswapper_128**  
    Upload a **face photo** (source) and a **target image** — the source face will be placed on every face found in the target.
    """)

    with gr.Row():
        with gr.Column():
            src_img = gr.Image(label="👤 Source — Face Photo", type="pil", height=300)
        with gr.Column():
            tgt_img = gr.Image(label="🎯 Target Image", type="pil", height=300)

    swap_btn = gr.Button("🔄 Swap Faces", variant="primary", size="lg")

    with gr.Row():
        out_img = gr.Image(label="✨ Result", type="pil", height=400)
        status_box = gr.Textbox(label="Status", lines=2, interactive=False)

    swap_btn.click(
        fn=gradio_swap,
        inputs=[src_img, tgt_img],
        outputs=[out_img, status_box],
        api_name="swap"          # enables REST API: POST /api/predict/swap
    )

    gr.HTML("""
    <div class="disclaimer">
      ⚖️ <strong>Legal:</strong> By using this tool you confirm you have the right to use all uploaded images.
      Do not upload images of real people without their consent. This tool is for creative/entertainment use only.
      Misuse may violate laws and platform policies.
    </div>
    """)

    gr.Markdown("""
    ---
    **API usage** (from Shashi Creator Studio):
    ```
    POST /api/predict/swap
    { "data": ["<base64-or-url>", "<base64-or-url>"] }
    ```
    Returns `{ "data": ["<result-image>", "<status-string>"] }`
    """)

if __name__ == "__main__":
    demo.launch()
