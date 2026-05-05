"""
Shashi Face Swap - HuggingFace Space
Supports: photo + VIDEO face swap + background replacement
"""
import os, cv2, numpy as np, tempfile, traceback, urllib.request
import gradio as gr
import insightface
from insightface.app import FaceAnalysis
from insightface.model_zoo import get_model
from PIL import Image

try:
    from rembg import remove as rembg_remove
    REMBG_OK = True
except ImportError:
    REMBG_OK = False

print("Loading InsightFace models...")
FACE_ANALYSER = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider","CPUExecutionProvider"])
FACE_ANALYSER.prepare(ctx_id=0, det_size=(640,640))
SWAPPER_PATH = os.path.join(os.path.dirname(__file__), "inswapper_128.onnx")
if not os.path.exists(SWAPPER_PATH):
    print("Downloading inswapper_128.onnx...")
    urllib.request.urlretrieve("https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx", SWAPPER_PATH)
SWAPPER = get_model(SWAPPER_PATH, providers=["CUDAExecutionProvider","CPUExecutionProvider"])
print("Models ready")

def pil_to_bgr(p): return cv2.cvtColor(np.array(p.convert("RGB")), cv2.COLOR_RGB2BGR)
def bgr_to_pil(b): return Image.fromarray(cv2.cvtColor(b, cv2.COLOR_BGR2RGB))

def get_src_face(bgr):
    faces = FACE_ANALYSER.get(bgr)
    if not faces: raise ValueError("No face detected in face photo.")
    return sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[0]

def swap_frame(frame, src_face, bg, bg_mode):
    for f in FACE_ANALYSER.get(frame):
        frame = SWAPPER.get(frame, f, src_face, paste_back=True)
    if bg_mode != "none" and REMBG_OK and bg is not None:
        h,w = frame.shape[:2]
        fg_rgba = np.array(rembg_remove(bgr_to_pil(frame)))
        alpha = fg_rgba[:,:,3:4]/255.0
        bg_r = cv2.cvtColor(cv2.resize(bg,(w,h)),cv2.COLOR_BGR2RGB).astype(float)
        fg_r = fg_rgba[:,:,:3].astype(float)
        out = (fg_r*alpha+bg_r*(1-alpha)).astype(np.uint8)
        frame = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    return frame

def load_bg(mode, path):
    URLS = {"nepal":"https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=1280&q=80",
            "office":"https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80",
            "stage":"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1280&q=80"}
    if mode=="none": return None
    if mode=="custom" and path: return cv2.imread(path)
    if mode=="black": return np.zeros((720,1280,3),dtype=np.uint8)
    if mode=="white": return np.full((720,1280,3),248,dtype=np.uint8)
    url=URLS.get(mode)
    if url:
        with urllib.request.urlopen(url,timeout=12) as r:
            return cv2.imdecode(np.frombuffer(r.read(),np.uint8),cv2.IMREAD_COLOR)
    return None

def photo_swap(face_pil, target_pil, bg_mode, bg_img):
    try:
        if face_pil is None: return None,"No face photo"
        if target_pil is None: return None,"No target image"
        sf = get_src_face(pil_to_bgr(face_pil))
        bg = load_bg(bg_mode, bg_img)
        return bgr_to_pil(swap_frame(pil_to_bgr(target_pil),sf,bg,bg_mode)),"Done!"
    except Exception as e:
        traceback.print_exc(); return None,str(e)

def video_swap(face_pil, vid_path, bg_mode, bg_img, progress=gr.Progress()):
    try:
        if face_pil is None: return None,"No face photo"
        if not vid_path: return None,"No video"
        sf = get_src_face(pil_to_bgr(face_pil))
        bg = load_bg(bg_mode, bg_img)
        cap=cv2.VideoCapture(vid_path)
        fps=cap.get(cv2.CAP_PROP_FPS) or 25
        w,h=int(cap.get(3)),int(cap.get(4))
        total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        out=tempfile.mktemp(suffix=".mp4")
        wr=cv2.VideoWriter(out,cv2.VideoWriter_fourcc(*"mp4v"),fps,(w,h))
        i=0
        while True:
            ok,frame=cap.read()
            if not ok: break
            wr.write(swap_frame(frame,sf,bg,bg_mode))
            i+=1
            if i%15==0: progress(i/max(total,1),desc=f"Frame {i}/{total}")
        cap.release(); wr.release()
        return out,f"Done! {i} frames"
    except Exception as e:
        traceback.print_exc(); return None,str(e)

BG = ["none","black","white","nepal","office","stage","custom"]

with gr.Blocks(title="Shashi Face Swap", theme=gr.themes.Soft(primary_hue="purple"),
               css=".gradio-container{max-width:960px;margin:auto}") as demo:
    gr.Markdown("# Shashi Face Swap Studio\nInsightFace + rembg - GPU accelerated")
    with gr.Tabs():
        with gr.TabItem("Photo Swap"):
            with gr.Row():
                pf=gr.Image(label="Your Face",type="pil",height=260)
                pt=gr.Image(label="Target Photo",type="pil",height=260)
                pr=gr.Image(label="Result",type="pil",height=260)
            with gr.Row():
                pbg=gr.Dropdown(BG,value="none",label="Background")
                pbi=gr.Image(label="Custom BG",type="filepath",height=120)
            pb=gr.Button("Swap Photo Faces",variant="primary")
            ps=gr.Textbox(label="Status",interactive=False,lines=1)
            pb.click(photo_swap,[pf,pt,pbg,pbi],[pr,ps],api_name="swap_photo")
        with gr.TabItem("Video Swap"):
            with gr.Row():
                vf=gr.Image(label="Your Face",type="pil",height=260)
                vt=gr.Video(label="Target Video (max 60s)",height=260)
            with gr.Row():
                vbg=gr.Dropdown(BG,value="none",label="Background")
                vbi=gr.Image(label="Custom BG",type="filepath",height=120)
            vb=gr.Button("Create My Video",variant="primary")
            vs=gr.Textbox(label="Status",interactive=False,lines=1)
            vr=gr.Video(label="Your Video",height=400)
            vb.click(video_swap,[vf,vt,vbg,vbi],[vr,vs],api_name="swap_video")
    gr.HTML("<div style='font-size:.72rem;color:#888;padding:8px;border:1px solid #333;border-radius:8px;margin-top:8px'>You confirm you own rights to all uploaded content. Creative/entertainment use only.</div>")

if __name__ == "__main__":
    demo.launch()
