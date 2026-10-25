from PIL import Image
import os

base = r"F:\DshWorkSpace\flotation-hmi\out"
names = ["hmi_cell", "hmi_camera", "hmi_light", "hmi_scraper", "hmi_pump",
         "hmi_telescopic", "hmi_suction", "hmi_vfd", "hmi_plc", "hmi_valve"]
parts = []
for n in names:
    im = Image.open(os.path.join(base, n + ".png"))
    l = im.crop((10, 80, 392, 932))
    r = im.crop((1288, 80, 1670, 932))
    pair = Image.new("RGB", (392 + 382 + 12, 852), (6, 8, 10))
    pair.paste(l, (0, 0))
    pair.paste(r, (404, 0))
    parts.append(pair.resize((393, 426)))
cols, rows = 5, 2
sheet = Image.new("RGB", (cols * 393 + (cols + 1) * 4, rows * 426 + (rows + 1) * 4), (6, 8, 10))
for i, p in enumerate(parts):
    x = 4 + (i % cols) * (393 + 4)
    y = 4 + (i // cols) * (426 + 4)
    sheet.paste(p, (x, y))
sheet.save(os.path.join(base, "hmi_parts_sheet.png"))
print(sheet.size)
