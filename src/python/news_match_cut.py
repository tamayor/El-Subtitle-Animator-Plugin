#!/usr/bin/env python3
"""News-article match cut, fully automated.

Give it a word (or short phrase). It:
  1. finds news articles containing it (Google News RSS) and screenshots them
     with a headless browser   -- and/or takes your own screenshots (--images)
  2. OCRs every image (tesseract) and finds the word's box (largest = headline)
  3. scales + shifts each image so the word is the same size in the same spot
  4. renders an MP4 (accelerating cuts, final hold, optional marker + click SFX)

In the app: header "Match Cut" button (src/main/match-cut.js), or the MCP tool match_cut. The app passes
--out-dir "<footage folder>/El Subtitle Animator MatchCut" (next to "El Subtitle Animator SFX") and the timeline's
size and frame rate, then places the MP4 at the playhead.

From a terminal
  python3 news_match_cut.py "AI"
  python3 news_match_cut.py "inflation" --count 15 --size 1920x1080 --highlight
  python3 news_match_cut.py "Bitcoin" --images ~/Desktop/shots --no-search
  python3 news_match_cut.py "interest rates" --sfx ~/click.wav --out-dir "/footage/El Subtitle Animator MatchCut"

Each run: <out-dir>/<word>/ (screenshots, frames, report.txt, <word>.mp4). Default out-dir:
./El Subtitle Animator MatchCut. Progress lines start with "PROGRESS ", the last line is "RESULT {json}".
"""
import argparse, html, json, os, re, shutil, subprocess, sys, tempfile
import urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFilter

RUNS_DIR_NAME = 'El Subtitle Animator MatchCut'
# Resolve's panel starts us with a bare PATH: tesseract / ffmpeg usually live in Homebrew
os.environ['PATH'] = os.environ.get('PATH', '') + ':/opt/homebrew/bin:/usr/local/bin'
BROWSERS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
# sites that serve a bot wall to headless browsers: skipped (use --images for them)
BLOCKED_SITES = ('reuters.com', 'wsj.com', 'nytimes.com', 'bloomberg.com', 'ft.com',
                 'washingtonpost.com', 'economist.com', 'barrons.com', 'marketwatch.com')
IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def log(*a):
    print(*a, flush=True)


def progress(phase, done, total, text=''):
    print(f'PROGRESS {json.dumps({"phase": phase, "done": done, "total": total, "text": text})}', flush=True)


# ---------------------------------------------------------------- sourcing
def find_browser():
    # Playwright's headless shell first: single binary, works where full browsers are sandboxed
    pw = os.path.expanduser('~/Library/Caches/ms-playwright')
    if os.path.isdir(pw):
        for d in sorted(os.listdir(pw), reverse=True):
            if not d.startswith('chromium'):
                continue
            for root, _, files in os.walk(os.path.join(pw, d)):
                if 'chrome-headless-shell' in files:
                    return os.path.join(root, 'chrome-headless-shell')
    for b in BROWSERS:
        if os.path.exists(b):
            return b
    return None


def news_links(query, count, lang):
    hl, gl = (lang.split('-') + ['US'])[:2]
    url = ('https://news.google.com/rss/search?q=' + urllib.parse.quote(f'intitle:"{query}"')
           + f'&hl={hl}-{gl}&gl={gl}&ceid={gl}:{hl}')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    data = urllib.request.urlopen(req, timeout=20).read()
    items = ET.fromstring(data).findall('.//item')
    out = []
    for it in items:
        src = it.find('source')
        site = (src.get('url') if src is not None else '') or ''
        if any(b in site for b in BLOCKED_SITES):
            continue
        out.append((it.findtext('link'), html.unescape(it.findtext('title') or '')))
    out = out[: count * 4]  # over-fetch: some pages fail / cookie walls / lack the word
    # Google's links open a redirect page that ad-heavy sites never finish loading behind: use the real URLs
    with ThreadPoolExecutor(8) as ex:
        real = list(ex.map(lambda o: decode_link(o[0], hl, gl), out))
    return [(r or u, t) for (u, t), r in zip(out, real)]


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'


def decode_link(link, hl='en', gl='US'):
    """The article URL behind a news.google.com/rss/articles/<id> link (None when Google does not say)."""
    try:
        gid = urllib.parse.urlparse(link).path.rstrip('/').split('/')[-1]
        page = urllib.request.urlopen(urllib.request.Request(
            'https://news.google.com/rss/articles/' + gid, headers={'User-Agent': UA}), timeout=15).read().decode('utf8', 'replace')
        sg = re.search(r'data-n-a-sg="([^"]+)"', page).group(1)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page).group(1)
        inner = json.dumps(['garturlreq', [['X', 'X', ['X', 'X'], None, None, 1, 1, f'{gl}:{hl}', None, 1, None, None, None,
                                            None, None, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], gid, int(ts), sg])
        body = urllib.parse.urlencode({'f.req': json.dumps([[['Fbv4je', inner, None, 'generic']]])}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            'https://news.google.com/_/DotsSplashUi/data/batchexecute', data=body,
            headers={'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}), timeout=15).read().decode()
        url = json.loads(json.loads(r.split('\n\n')[1])[0][2])[1]
        return url if url.startswith('http') else None
    except Exception:
        return None


def screenshot(browser, url, path, w=1280, h=1500, scale=2):
    prof = tempfile.mkdtemp(prefix='mc-prof-')
    cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
           '--no-first-run', '--no-default-browser-check', f'--user-data-dir={prof}',
           f'--window-size={w},{h}', f'--force-device-scale-factor={scale}',
           '--lang=en-US', f'--user-agent={UA}', f'--screenshot={path}', url]
    # a real article: captured when loaded or after 12 s at the latest (ads keep news pages "loading" for ever);
    # a Google redirect link (not decoded) needs virtual time for its script to forward to the article
    cmd[-2:-2] = ['--virtual-time-budget=12000', '--timeout=25000'] if 'news.google.com' in url else ['--timeout=12000']
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=40)
    except subprocess.TimeoutExpired:
        pass
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    return os.path.exists(path) and os.path.getsize(path) > 20000


# ---------------------------------------------------------------- OCR
def norm(s):
    s = re.sub(r"[^\w$%€£¥|]", '', s.lower())
    return s.translate(str.maketrans({'l': 'i', '1': 'i', '|': 'i', '0': 'o'}))  # OCR: "AI" -> "Al"


def ocr_words(path, psm):
    r = subprocess.run(['tesseract', path, 'stdout', '--psm', str(psm), 'tsv'],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors='replace')
    rows = []
    for ln in r.stdout.splitlines()[1:]:
        p = ln.split('\t')
        if len(p) < 12 or not p[11].strip():
            continue
        try:
            conf = float(p[10])
        except ValueError:
            continue
        rows.append(dict(line=(p[2], p[3], p[4]), x=int(p[6]), y=int(p[7]),
                         w=int(p[8]), h=int(p[9]), conf=conf, text=p[11]))
    return rows


def find_word(path, query, min_conf):
    """Return (x, y, w, h) of the largest match of `query` (1+ words), or None."""
    target = [norm(t) for t in query.split() if norm(t)]
    best = None
    for psm in (3, 11):
        rows = ocr_words(path, psm)
        for i in range(len(rows) - len(target) + 1):
            win = rows[i:i + len(target)]
            if len({r['line'] for r in win}) > 1 and psm == 3:
                continue
            ok = all(norm(r['text']) == t or (len(t) > 3 and norm(r['text']).rstrip('s') == t)
                     for r, t in zip(win, target))
            # the text match itself is evidence: OCR is unsure of apostrophes ("Singapore's" = 52), so the words
            # pass on their average, with no single word near-illegible
            # (long words matched letter for letter can score as low as 20; short ones like "AI" must read cleanly)
            confs = [r['conf'] for r in win]
            if not ok or any(c < (15 if len(t) >= 5 else 30) for c, t in zip(confs, target)) or sum(confs) / len(confs) < min_conf:
                continue
            x0 = min(r['x'] for r in win); y0 = min(r['y'] for r in win)
            x1 = max(r['x'] + r['w'] for r in win); y1 = max(r['y'] + r['h'] for r in win)
            if x1 - x0 < 8 or y1 - y0 < 8:
                continue
            cand = (x0, y0, x1 - x0, y1 - y0)
            if best is None or cand[3] > best[3]:
                best = cand
        if best:
            break
    return best


# ---------------------------------------------------------------- render
def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def compose(path, box, W, H, word_h, cx, cy, highlight, max_up):
    img = Image.open(path).convert('RGB')
    x, y, w, h = box
    s = min(word_h / h, max_up)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    bx, by, bw, bh = x * s, y * s, w * s, h * s
    ox, oy = round(cx - (bx + bw / 2)), round(cy - (by + bh / 2))
    bg = img.resize((1, 1), Image.BOX).getpixel((0, 0))
    canvas = Image.new('RGB', (W, H), bg)
    # soft blurred fill so edges of short pages never show a hard border
    fill = img.resize((W, H)).filter(ImageFilter.GaussianBlur(40))
    canvas.paste(fill)
    canvas.paste(img, (ox, oy))
    if highlight:
        pad = bh * 0.18
        mark = Image.new('RGB', (W, H), (255, 255, 255))
        ImageDraw.Draw(mark).rounded_rectangle(
            [ox + bx - pad, oy + by - pad, ox + bx + bw + pad, oy + by + bh + pad],
            radius=pad, fill=hex_rgb(highlight))
        from PIL import ImageChops
        canvas = ImageChops.multiply(canvas, mark)
    return canvas


def durations(n, fps, start, end, hold):
    """Frames per image: eases from `start` to `end`, last image holds `hold` seconds."""
    if n == 1:
        return [round(hold * fps)]
    out = []
    for i in range(n - 1):
        t = i / max(1, n - 2)
        out.append(max(1, round(start + (end - start) * (t * t))))
    out.append(max(1, round(hold * fps)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('word', help='word or short phrase to match on')
    ap.add_argument('--count', type=int, default=12, help='articles to use (default 12)')
    ap.add_argument('--images', help='folder of your own screenshots (used first)')
    ap.add_argument('--no-search', action='store_true', help="don't fetch articles, use --images only")
    ap.add_argument('--lang', default='en-US')
    ap.add_argument('--size', default='1080x1920', help='WxH (default 1080x1920; 1920x1080 for 16:9)')
    ap.add_argument('--fps', type=float, default=25)
    ap.add_argument('--word-height', type=float, default=0.045, help='word height as fraction of frame height')
    ap.add_argument('--pos', default='0.5,0.5', help='word centre x,y (0..1)')
    ap.add_argument('--start-frames', type=float, default=6, help='frames per image at the start')
    ap.add_argument('--end-frames', type=float, default=2, help='frames per image near the end')
    ap.add_argument('--hold', type=float, default=1.2, help='seconds to hold the last article')
    ap.add_argument('--highlight', nargs='?', const='#8ccf8e', help='marker behind the word (default matcha)')
    ap.add_argument('--sfx', help='click per cut: path to a sound file')
    ap.add_argument('--max-upscale', type=float, default=3.0)
    ap.add_argument('--min-conf', type=float, default=55)
    ap.add_argument('--min-articles', type=int, default=3, help='fail rather than make a near-still clip')
    ap.add_argument('--out-dir', help=f'folder for runs (default ./{RUNS_DIR_NAME}); each run gets <word>/')
    a = ap.parse_args()

    W, H = map(int, a.size.lower().split('x'))
    px, py = map(float, a.pos.split(','))
    slug = re.sub(r'\W+', '-', a.word.lower()).strip('-') or 'word'
    out_dir = os.path.join(os.path.expanduser(a.out_dir) if a.out_dir else os.path.join(os.getcwd(), RUNS_DIR_NAME), slug)
    shots_dir = os.path.join(out_dir, 'screenshots'); frames_dir = os.path.join(out_dir, 'frames')
    os.makedirs(shots_dir, exist_ok=True)
    shutil.rmtree(frames_dir, ignore_errors=True); os.makedirs(frames_dir)
    # a new file per run: Resolve keeps the old one in its Media Pool, overwriting it would swap a placed clip
    out, k = os.path.join(out_dir, f'{slug}.mp4'), 2
    while os.path.exists(out):
        out, k = os.path.join(out_dir, f'{slug} {k}.mp4'), k + 1
    for tool in ('tesseract', 'ffmpeg'):
        if not shutil.which(tool):
            sys.exit(f'{tool} is not installed. Install it with: brew install {tool}')
    report = []

    # 1. sources
    sources = []  # (path, label)
    if a.images:
        d = os.path.expanduser(a.images)
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(IMG_EXT):
                sources.append((os.path.join(d, f), f))
    if not a.no_search and len(sources) < a.count:
        browser = find_browser()
        if not browser:
            sys.exit('No Chromium browser found for screenshots; pass --images instead.')
        links = news_links(a.word, a.count, a.lang)
        log(f'{len(links)} news results for "{a.word}"; screenshotting with {os.path.basename(browser)}…')

        def grab(arg):
            i, (url, title) = arg
            p = os.path.join(shots_dir, f'{i:02d}.png')
            return (p, title) if (os.path.exists(p) or screenshot(browser, url, p)) else None

        progress('shots', 0, len(links), f'Screenshotting {len(links)} articles')
        with ThreadPoolExecutor(6) as ex:
            for i, r in enumerate(ex.map(grab, enumerate(links))):
                if r:
                    sources.append(r)
                progress('shots', i + 1, len(links), f'Screenshots {i + 1}/{len(links)}')

    # 2. OCR
    log(f'OCR on {len(sources)} images…')
    progress('ocr', 0, len(sources), f'Finding "{a.word}" in {len(sources)} images')
    with ThreadPoolExecutor(os.cpu_count() or 4) as ex:
        boxes = []
        for i, b in enumerate(ex.map(lambda s: find_word(s[0], a.word, a.min_conf), sources)):
            boxes.append(b)
            progress('ocr', i + 1, len(sources), f'Reading text {i + 1}/{len(sources)}')
    hits = []
    for (p, label), b in zip(sources, boxes):
        if b:
            hits.append((p, label, b))
            report.append(f'USED   {os.path.basename(p)}  box={b}  {label}')
        else:
            report.append(f'SKIP   {os.path.basename(p)}  word not found  {label}')
        if len(hits) >= a.count:
            break
    if len(hits) < a.min_articles:
        found = f'only {len(hits)} of {len(sources)} articles show' if hits else 'no article shows'
        sys.exit(f'Not enough for a match cut: {found} "{a.word}" clearly (need {a.min_articles}). '
                 f'Try a shorter word, or more articles. Screenshots: {shots_dir}')
    log(f'{len(hits)} images contain "{a.word}".')

    # 3. render frames
    word_h = a.word_height * H
    durs = durations(len(hits), a.fps, a.start_frames, a.end_frames, a.hold)
    n, cuts = 0, []
    for i, ((p, _, b), d) in enumerate(zip(hits, durs)):
        progress('render', i, len(hits), f'Lining up {i + 1}/{len(hits)}')
        cuts.append(n / a.fps)
        frame = compose(p, b, W, H, word_h, px * W, py * H, a.highlight, a.max_upscale)
        frame.save(os.path.join(frames_dir, f'{n:05d}.png'))
        for k in range(1, d):
            os.link(os.path.join(frames_dir, f'{n:05d}.png'), os.path.join(frames_dir, f'{n + k:05d}.png'))
        n += d

    # 4. encode
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(a.fps),
           '-i', os.path.join(frames_dir, '%05d.png')]
    progress('encode', 0, 1, 'Encoding the MP4')
    sfx = os.path.expanduser(a.sfx) if a.sfx else None
    if sfx and os.path.exists(sfx):
        for _ in cuts:
            cmd += ['-i', sfx]
        parts = ''.join(f'[{i + 1}:a]adelay={int(t * 1000)}|{int(t * 1000)}[a{i}];' for i, t in enumerate(cuts))
        mix = ''.join(f'[a{i}]' for i in range(len(cuts)))
        cmd += ['-filter_complex', parts + f'{mix}amix=inputs={len(cuts)}:normalize=0,apad[aout]',
                '-map', '0:v', '-map', '[aout]', '-c:a', 'aac']
    cmd += ['-t', f'{n / a.fps:.3f}']
    cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', out]
    subprocess.run(cmd, check=True)

    with open(os.path.join(out_dir, 'report.txt'), 'w') as f:
        f.write('\n'.join(report) + '\n')
    log(f'Done: {out}  ({n} frames, {n / a.fps:.1f}s, {len(hits)} articles)')
    log(f'Report: {os.path.join(out_dir, "report.txt")}')
    print('RESULT ' + json.dumps({'out': out, 'dir': out_dir, 'frames': n, 'fps': a.fps,
                                  'articles': len(hits), 'skipped': len(sources) - len(hits)}), flush=True)


if __name__ == '__main__':
    main()
