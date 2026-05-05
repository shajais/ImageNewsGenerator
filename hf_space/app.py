"""
Shashi Face Swap - HuggingFace Space
Supports: photo + VIDEO face swap + background replacement
Falls back gracefully if InsightFace/ONNX is unavailable.
"""
import os, cv2, numpy as np, tempfile, traceback, urllib.request
import gradio as gr
from PIL import Image, ImageDraw, ImageFilter

# ── Try loading InsightFace (may fail on some HF hardware) ────────────────────
SWAPPER = None
FACE_ANALYSER = None

try:
    import insightface
    from insightface.app import FaceAnalysis
    from insightface.model_zoo import get_model

    print("Loading InsightFace models...")
    FACE_ANALYSER = FaceAnalysis(
        name="buffalo_l",
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    FACE_ANALYSER.prepare(ctx_id=0, det_size=(640, 640))

    SWAPPER_PATH = os.path.join(os.path.dirname(__file__), "inswapper_128.onnx")
    if not os.path.exists(SWAPPER_PATH):
        print("Downloading inswapper_128.onnx (~256 MB)...")
        urllib.request.urlretrieve(
            "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx",
            SWAPPER_PATH
        )
    SWAPPER = get_model(SWAPPER_PATH, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    print("✅ InsightFace + Swapper ready")
except Exception as e:
    print(f"⚠️  InsightFace not available ({e}). Will use canvas-blend fallback.")

# ── Try rembg ─────────────────────────────────────────────────────────────────
try:
    from rembg import remove as rembg_remove
    REMBG_OK = True
    print("✅ rembg ready")
except Exception:
    REMBG_OK = False
    print("⚠️  rembg not available")

# ── Helpers ───────────────────────────────────────────────────────────────────
def pil_to_bgr(p):
    return cv2.cvtColor(np.array(p.convert("RGB")), cv2.COLOR_RGB2BGR)

def bgr_to_pil(b):
    return Image.fromarray(cv2.cvtColor(b, cv2.COLOR_BGR2RGB))

def get_src_face(bgr):
    if FACE_ANALYSER is None:
        return None
    faces = FACE_ANALYSER.get(bgr)
    if not faces:
        raise ValueError("No face detected in face photo. Please use a clear, front-facing photo.")
    return sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[0]

def load_bg(mode, path):
    URLS = {
        "nepal":  "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1280&q=80",
        "office": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80",
        "stage":  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1280&q=80",
    }
    if mode == "none": return None
    if mode == "custom" and path: return cv2.imread(path)
    if mode == "black": return np.zeros((720, 1280, 3), dtype=np.uint8)
    if mode == "white": return np.full((720, 1280, 3), 248, dtype=np.uint8)
    url = URLS.get(mode)
    if url:
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                return cv2.imdecode(np.frombuffer(r.read(), np.uint8), cv2.IMREAD_COLOR)
        except Exception:
            return None
    return None

def apply_bg(frame_bgr, bg, bg_mode):
    if bg_mode == "none" or bg is None or not REMBG_OK:
        return frame_bgr
    try:
        h, w = frame_bgr.shape[:2]
        fg_rgba = np.array(rembg_remove(bgr_to_pil(frame_bgr)))
        alpha = fg_rgba[:, :, 3:4] / 255.0
        bg_r = cv2.cvtColor(cv2.resize(bg, (w, h)), cv2.COLOR_BGR2RGB).astype(float)
        fg_r = fg_rgba[:, :, :3].astype(float)
        out = (fg_r * alpha + bg_r * (1 - alpha)).astype(np.uint8)
        return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    except Exception:
        return frame_bgr

def swap_frame(frame, src_face, bg, bg_mode):
    if SWAPPER is not None and src_face is not None and FACE_ANALYSER is not None:
        for f in FACE_ANALYSER.get(frame):
            frame = SWAPPER.get(frame, f, src_face, paste_back=True)
    return apply_bg(frame, bg, bg_mode)

# ── Fallback: canvas blend (no InsightFace) ───────────────────────────────────
def canvas_blend(face_pil: Image.Image, target_pil: Image.Image) -> Image.Image:
    tw, th = target_pil.size
    canvas = target_pil.convert("RGBA").copy()
    fh = int(th * 0.55)
    fw = int(face_pil.width * fh / face_pil.height)
    face_r = face_pil.convert("RGBA").resize((fw, fh), Image.LANCZOS)
    mask = Image.new("L", (fw, fh), 0)
    d = ImageDraw.Draw(mask)
    margin = int(min(fw, fh) * 0.05)
    d.ellipse([margin, margin, fw - margin, fh - margin], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(int(min(fw, fh) * 0.04)))
    face_r.putalpha(mask)
    px, py = (tw - fw) // 2, int(th * 0.15)
    canvas.paste(face_r, (px, py), face_r)
    result = canvas.convert("RGB")
    ImageDraw.Draw(result).text((10, th - 28), "✨ Shashi Creator Studio", fill=(255, 255, 255))
    return result

# ── Main swap functions ───────────────────────────────────────────────────────
def photo_swap(face_pil, target_pil, bg_mode, bg_img):
    try:
        if face_pil is None: return None, "❌ Please upload a face photo."
        if target_pil is None: return None, "❌ Please upload a target image."
        bg = load_bg(bg_mode, bg_img)
        if SWAPPER is not None:
            sf = get_src_face(pil_to_bgr(face_pil))
            result_bgr = swap_frame(pil_to_bgr(target_pil), sf, bg, bg_mode)
            return bgr_to_pil(result_bgr), "✅ Done! (AI face swap)"
        else:
            return canvas_blend(face_pil, target_pil), "✅ Done! (Preview blend — GPU not available)"
    except Exception as e:
        traceback.print_exc()
        return None, f"❌ Error: {e}"

def video_swap(face_pil, vid_path, bg_mode, bg_img, progress=gr.Progress()):
    try:
        if face_pil is None: return None, "❌ Please upload a face photo."
        if not vid_path: return None, "❌ Please upload a target video."
        bg = load_bg(bg_mode, bg_img)
        src_face = get_src_face(pil_to_bgr(face_pil)) if SWAPPER else None
        cap = cv2.VideoCapture(vid_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        w, h = int(cap.get(3)), int(cap.get(4))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        out_path = tempfile.mktemp(suffix=".mp4")
        writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok: break
            writer.write(swap_frame(frame, src_face, bg, bg_mode))
            i += 1
            if i % 10 == 0: progress(i / max(total, 1), desc=f"Frame {i}/{total}")
        cap.release(); writer.release()
        mode = "AI face swap" if SWAPPER else "bg-only (InsightFace unavailable)"
        return out_path, f"✅ Done! {i} frames ({mode})"
    except Exception as e:
        traceback.print_exc()
        return None, f"❌ Error: {e}"

# ── Gradio UI ─────────────────────────────────────────────────────────────────
BG_CHOICES = ["none", "black", "white", "nepal", "office", "stage", "custom"]
status_msg = "✅ InsightFace AI loaded" if SWAPPER else "⚠️  GPU model loading — canvas preview active"

with gr.Blocks(
    title="Shashi Face Swap",
    theme=gr.themes.Soft(primary_hue="purple"),
    css=".gradio-container{max-width:960px;margin:auto}"
) as demo:
    gr.Markdown(f"# 🎭 Shashi Face Swap Studio\n**Status:** {status_msg}")
    with gr.Tabs():
        with gr.TabItem("📸 Photo Swap"):
            with gr.Row():
                pf = gr.Image(label="Your Face Photo", type="pil", height=280)
                pt = gr.Image(label="Target Photo",    type="pil", height=280)
                pr = gr.Image(label="Result",          type="pil", height=280)
            with gr.Row():
                pbg = gr.Dropdown(BG_CHOICES, value="none", label="Background Mode")
                pbi = gr.Image(label="Custom BG Image", type="filepath", height=120)
            pb = gr.Button("🔄 Swap Photo Faces", variant="primary")
            ps = gr.Textbox(label="Status", interactive=False, lines=1)
            pb.click(photo_swap, [pf, pt, pbg, pbi], [pr, ps], api_name="swap_photo")
        with gr.TabItem("🎬 Video Swap"):
            with gr.Row():
                vf = gr.Image(label="Your Face Photo", type="pil",  height=280)
                vt = gr.Video(label="Target Video (max 60s)",        height=280)
            vr = gr.Video(label="Result Video", height=360)
            with gr.Row():
                vbg = gr.Dropdown(BG_CHOICES, value="none", label="Background Mode")
                vbi = gr.Image(label="Custom BG Image", type="filepath", height=120)
            vb = gr.Button("🎬 Create My Video", variant="primary")
            vs = gr.Textbox(label="Status", interactive=False, lines=1)
            vb.click(video_swap, [vf, vt, vbg, vbi], [vr, vs], api_name="swap_video")
    gr.HTML("<div style='font-size:.72rem;color:#888;padding:8px;border:1px solid #333;border-radius:8px;margin-top:8px'>You confirm you own rights to all uploaded content. Creative/entertainment use only.</div>")

if __name__ == "__main__":
    demo.launch()
