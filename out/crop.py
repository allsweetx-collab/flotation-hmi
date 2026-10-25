from PIL import Image
import os
base = r"F:\DshWorkSpace\flotation-hmi\out"
im = Image.open(os.path.join(base, "hmi_1366.png"))
top = im.crop((0, 0, 1366, 72)).resize((2732, 144), Image.LANCZOS)
top.save(os.path.join(base, "_crop_topbar.png"))
flow = im.crop((8, 76, 360, 260)).resize((1056, 552), Image.LANCZOS)
flow.save(os.path.join(base, "_crop_flow.png"))
cut = im.crop((8, 680, 360, 760)).resize((1056, 240), Image.LANCZOS)
cut.save(os.path.join(base, "_crop_cut.png"))
print("ok")
