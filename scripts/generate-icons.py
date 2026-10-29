from PIL import Image, ImageDraw
src=Image.open('/workspace/123ecriture-assets/new-icon.png').convert('RGBA')
B=43
sprite=src.crop((215,387,1505,1677)).resize((30,30),Image.NEAREST)
# sanity: resize NEAREST from block-aligned crop samples block pixels
WHITE=(255,255,255,255)
def place(S,frac,bg=None,shape='square'):
    k=max(1,int(S*frac)//30)
    if 30*k> S*frac+0.5 and k>1: k-=1
    sp=sprite.resize((30*k,30*k),Image.NEAREST)
    if 30*k>S: sp=sprite.resize((int(S*frac),)*2,Image.NEAREST)
    c=Image.new('RGBA',(S,S),(0,0,0,0))
    if bg:
        m=Image.new('L',(S,S),0);d=ImageDraw.Draw(m)
        if shape=='circle': d.ellipse((0,0,S-1,S-1),fill=255)
        elif shape=='rounded': d.rounded_rectangle((0,0,S-1,S-1),radius=S//6,fill=255)
        else: d.rectangle((0,0,S,S),fill=255)
        c.paste(Image.new('RGBA',(S,S),bg),(0,0),m)
    o=(S-sp.size[0])//2
    c.alpha_composite(sp,(o,o))
    return c
def mono(img):
    a=img.getchannel('A');out=Image.new('RGBA',img.size,(0,0,0,0));out.paste(Image.new('RGBA',img.size,(0,0,0,255)),(0,0),a);return out
A='assets/'
place(1024,0.80,WHITE).convert('RGB').save(A+'icon.png')
place(512,0.66).save(A+'android-icon-foreground.png')
Image.new('RGBA',(512,512),WHITE).save(A+'android-icon-background.png')
mono(place(432,0.66)).save(A+'android-icon-monochrome.png')
place(48,0.66).save(A+'favicon.png')
place(1024,0.5).save(A+'splash-icon.png')
R='android/app/src/main/res/'
for d,m in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
    L=int(48*m);F=int(108*m);P=int(288*m)
    place(L,0.75,WHITE,'rounded').save(R+f'mipmap-{d}/ic_launcher.webp',lossless=True)
    place(L,0.62,WHITE,'circle').save(R+f'mipmap-{d}/ic_launcher_round.webp',lossless=True)
    place(F,0.66).save(R+f'mipmap-{d}/ic_launcher_foreground.webp',lossless=True)
    Image.new('RGBA',(F,F),WHITE).save(R+f'mipmap-{d}/ic_launcher_background.webp',lossless=True)
    mono(place(F,0.66)).save(R+f'mipmap-{d}/ic_launcher_monochrome.webp',lossless=True)
    place(P,0.5).save(R+f'drawable-{d}/splashscreen_logo.png')
# ico: sprite on transparent; sizes
sizes=[16,24,32,48,64,128,256]
imgs=[]
for s in sizes:
    if s<30: imgs.append(sprite.resize((s,s),Image.NEAREST))
    else: imgs.append(place(s,0.94))
imgs[-1].save('../desktop/build/icon.ico',sizes=[(s,s) for s in sizes],append_images=imgs[:-1])
# previews
P='/workspace/123ecriture-assets/preview/'
place(1024,0.80,WHITE).save(P+'icon-1024.png')
fg=place(432,0.66);bgc=Image.new('RGBA',(432,432),WHITE);bgc.alpha_composite(fg)
for name,shape in [('circle','circle'),('squircle','rounded')]:
    m=Image.new('L',(432,432),0);d=ImageDraw.Draw(m)
    (d.ellipse if shape=='circle' else lambda b,fill:d.rounded_rectangle(b,radius=100,fill=fill))((0,0,431,431),fill=255)
    o=Image.new('RGBA',(432,432),(40,40,40,255));o.paste(bgc,(0,0),m)
    d2=ImageDraw.Draw(o);d2.ellipse((72,72,360,360),outline=(255,0,0,255))  # safe zone 66%
    o.save(P+f'android-adaptive-{name}-safezone.png')
o=Image.new('RGBA',(432,432),(40,40,40,255));o.paste(bgc,(0,0),None);o=o.resize((432,432));
mono(fg).save(P+'android-monochrome.png')
sh=Image.new('RGBA',(700,260),(230,230,230,255));x=10
for s,im in zip(sizes,imgs):
    big=im.resize((s*2 if s<128 else s,)*2,Image.NEAREST) if s<128 else im
    sh.alpha_composite(big,(x,10));x+=big.size[0]+10
sh.save(P+'windows-ico-sizes.png')
sp=Image.new('RGBA',(400,800),WHITE);l=place(576,0.5);sp.alpha_composite(l.resize((400,400),Image.NEAREST) if False else l.crop((88,88,488,488)),(0,200));sp.save(P+'splash.png')
import math
def fits(img,S):
    a=img.getchannel('A').load();r=0.305*S;c=S/2
    return all(math.hypot(x+0.5-c,y+0.5-c)<=r for y in range(S) for x in range(S) if a[x,y]>0)
def fg_for(S):
    for f in [x/100 for x in range(66,30,-1)]:
        im=place(S,f)
        if fits(im,S): return im,f
for S,paths in [(512,[A+'android-icon-foreground.png']),(432,[A+'android-icon-monochrome.png'])]:
    im,f=fg_for(S);print(S,f)
    (mono(im) if 'mono' in paths[0] else im).save(paths[0])
for d,m in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
    F=int(108*m);im,f=fg_for(F);print(d,f,im.getchannel('A').getbbox())
    im.save(R+f'mipmap-{d}/ic_launcher_foreground.webp',lossless=True)
    mono(im).save(R+f'mipmap-{d}/ic_launcher_monochrome.webp',lossless=True)
fg,_=fg_for(432);bgc=Image.new('RGBA',(432,432),WHITE);bgc.alpha_composite(fg)
v=bgc.crop((72,72,360,360))  # viewport 72dp/108dp
for name in ['circle','squircle']:
    m=Image.new('L',(288,288),0);d=ImageDraw.Draw(m)
    if name=='circle': d.ellipse((0,0,287,287),fill=255)
    else: d.rounded_rectangle((0,0,287,287),radius=70,fill=255)
    o=Image.new('RGBA',(288,288),(40,40,40,255));o.paste(v,(0,0),m);o.save(P+f'android-adaptive-{name}-safezone.png')
mono(fg).save(P+'android-monochrome.png')
