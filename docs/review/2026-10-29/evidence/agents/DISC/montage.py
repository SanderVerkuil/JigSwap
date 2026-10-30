import sys
from PIL import Image
out = sys.argv[1]; scale=float(sys.argv[2]); files = sys.argv[3:]
ims=[Image.open(f).convert('RGB') for f in files]
ims=[im.resize((int(im.width*scale), int(im.height*scale))) for im in ims]
W=sum(i.width for i in ims)+10*(len(ims)-1); H=max(i.height for i in ims)
m=Image.new('RGB',(W,H),(255,0,0)); x=0
for i in ims: m.paste(i,(x,0)); x+=i.width+10
m.save(out, quality=85)
print(m.size)
