#!/usr/bin/env python3
"""Build the Math question bank from a College Board Question Bank PDF export.

Math equations/graphs in the export are vector drawings with no text layer, so instead of OCR we crop each
part of every question (stem, each answer choice, rationale) out of the rendered page as an image, and take
metadata + the correct answer from the text layer.

usage: python3 scripts/build_math.py <export.pdf> [--out-js js/math.js] [--out-img img/math]
                                     [--pages 1-40] [--dpi 144] [--workers 6]
Needs poppler (pdftotext, pdftocairo) and Pillow + numpy.
"""
import argparse, io, json, re, subprocess, sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

PAGE_H = 792.0
DOMAIN_LABEL = {'Algebra': 'Algebra', 'Advanced Math': 'Advanced Math',
                'Problem-Solving and Data Analysis': 'Problem Solving & Data Analysis',
                'Geometry and Trigonometry': 'Geometry & Trigonometry'}
LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)</word>')


def unesc(s):
    return s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")


def read_layout(pdf, first, last):
    """-> {page: [(x0, y0, x1, y1, text, first_word_xmax)]}"""
    xml = subprocess.run(['pdftotext', '-f', str(first), '-l', str(last), '-bbox-layout', pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    pages = {}
    for n, pg in enumerate(xml.split('<page ')[1:], start=first):
        lines = []
        for m in LINE.finditer(pg):
            words = WORD.findall(m.group(5))
            if not words:
                continue
            text = unesc(' '.join(w[2] for w in words))
            lines.append((float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)), text, float(words[0][1])))
        pages[n] = lines
    return pages


def split_questions(pages):
    """Group consecutive pages into questions (a question starts at a 'Question ID:' line)."""
    qs, cur = [], None
    for n in sorted(pages):
        head = next((l for l in pages[n] if l[4].startswith('Question ID:')), None)
        if head:
            cur = {'id': head[4].split(':')[1].strip(), 'pages': []}
            qs.append(cur)
        if cur is not None:
            cur['pages'].append(n)
    return qs


def render(pdf, page, dpi):
    png = subprocess.run(['pdftocairo', '-png', '-gray', '-singlefile', '-r', str(dpi), '-f', str(page), '-l', str(page), pdf, '-'],
                         capture_output=True, check=True).stdout
    return np.asarray(Image.open(io.BytesIO(png)).convert('L'))


def tighten(arr, scale, gap_pt=26, keep_pt=10):
    """Trim blank margins and collapse long blank runs (e.g. across a page break)."""
    ink = (arr < 235).any(axis=1)
    rows = np.flatnonzero(ink)
    if rows.size == 0:
        return None
    arr = arr[max(rows[0] - 4, 0): rows[-1] + 5]
    ink = (arr < 235).any(axis=1)
    out, run, gap, keep = [], 0, int(gap_pt * scale), int(keep_pt * scale)
    i = 0
    while i < len(arr):
        if ink[i]:
            out.append(arr[i]); i += 1; continue
        j = i
        while j < len(arr) and not ink[j]:
            j += 1
        n = j - i
        out.extend(arr[i:i + (keep if n > gap else n)])
        i = j
    cols = np.flatnonzero((np.array(out) < 235).any(axis=0))
    out = np.array(out)
    return out[:, max(cols[0] - 4, 0): cols[-1] + 5] if cols.size else out


def save(arr, path, fmt, quality):
    im = Image.fromarray(arr)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == 'webp':
        im.save(path, 'WEBP', quality=quality, method=6)
    else:
        im.quantize(16).save(path, 'PNG', optimize=True)
    return path.stat().st_size


def process(job):
    pdf, q, lines_by_page, dpi, out_img, fmt, quality = job
    scale = dpi / 72.0
    qid, pgs = q['id'], q['pages']
    L = []  # global-coordinate lines
    for k, n in enumerate(pgs):
        for x0, y0, x1, y1, t, w0x in lines_by_page[n]:
            L.append((x0, y0 + k * PAGE_H, x1, y1 + k * PAGE_H, t, w0x))
    L.sort(key=lambda l: (l[1], l[0]))

    def find(pred, after=-1.0):
        return next((l for l in L if l[1] > after and pred(l)), None)

    qlab = find(lambda l: l[4] == 'Question')
    alab = find(lambda l: l[4] == 'Answer', qlab[1] if qlab else -1)
    corr = find(lambda l: l[4].startswith('Correct Answer:'), qlab[1] if qlab else -1)
    rlab = find(lambda l: l[4] == 'Rationale', (corr or qlab or (0, -1))[1])
    if not (qlab and rlab):
        return {'id': qid, 'error': 'anchors'}
    rationale_answer = None
    if not corr and alab:
        # fall back to the rationale's own text: "Choice C is correct."
        after = ' '.join(l[4] for l in L if l[1] > rlab[1])
        m = re.search(r'Choice ([A-D]) is (?:the best answer|correct)', after)
        if not m:
            return {'id': qid, 'error': 'mc without answer'}
        rationale_answer = m.group(1)
    # some free-response items have the answer only as a vector drawing (no text): self-graded in the UI
    end_anchor = corr or rlab

    # metadata table (first page): columns at x ~ 25/140/255/370/485
    meta = {k: [] for k in ('domain', 'skill', 'diff')}
    for x0, y0, x1, y1, t, _ in L:
        if 75 < y0 < qlab[1] - 5 and y0 < PAGE_H:
            col = 'domain' if 240 <= x0 < 360 else 'skill' if 360 <= x0 < 480 else 'diff' if x0 >= 480 else None
            if col:
                meta[col].append(t)
    domain, skill, diff = ' '.join(meta['domain']), ' '.join(meta['skill']), ' '.join(meta['diff']).strip().lower()
    if domain not in DOMAIN_LABEL or diff not in ('easy', 'medium', 'hard'):
        return {'id': qid, 'error': f'meta {domain!r} {diff!r}'}

    pages_px = [render(pdf, n, dpi) for n in pgs]
    H = pages_px[0].shape[0]
    stack = np.vstack(pages_px)
    ys = H / PAGE_H  # px per pt in the stack (== scale, up to rounding)

    def crop(top_pt, bot_pt, left_pt=0.0):
        a = stack[int(top_pt * ys): int(bot_pt * ys), int(left_pt * ys):]
        return tighten(a, scale)

    res = {'id': qid, 'domain': DOMAIN_LABEL[domain], 'skill': skill, 'diff': diff,
           'answer_raw': corr[4].split(':', 1)[1].strip() if corr else rationale_answer, 'pages': len(pgs)}
    sizes = 0
    files = {}

    # tall fractions poke above a label's text box, so cut a little above each anchor
    stem_end = (alab or end_anchor)[1]
    stem = crop(qlab[3] + 3, stem_end - 9)
    if stem is None:
        return {'id': qid, 'error': 'empty stem'}
    files['q'] = stem

    if alab:
        labels = [l for l in L if alab[1] < l[1] < end_anchor[1] and l[0] < 30 and re.match(r'^[A-D]\.', l[4])]
        per_choice = {}
        if [l[4][0] for l in labels] == list('ABCD'):
            ends = [l[1] for l in labels[1:]] + [end_anchor[1]]
            for i, (lab, end) in enumerate(zip(labels, ends)):
                c = crop(lab[1] - 9, end - 9, lab[5] + 1.5) if end - lab[1] > 6 else None
                if c is None:
                    per_choice = {}; break
                per_choice[f'c{i}'] = c
        if len(per_choice) == 4:
            files.update(per_choice)
        else:  # odd layout (e.g. 2x2 grid of graphs): keep the block whole, UI shows plain A-D buttons
            block = crop(alab[3] + 2, end_anchor[1] - 9)
            if block is None:
                return {'id': qid, 'error': 'empty choices block'}
            files['cs'] = block
        res['kind'] = 'mc'
    else:
        res['kind'] = 'spr'

    last_pt = len(pgs) * PAGE_H
    rat = crop(rlab[3] + 3, last_pt)
    if rat is not None:
        files['r'] = rat

    ext = 'webp' if fmt == 'webp' else 'png'
    res['files'] = {}
    for key, arr in files.items():
        p = Path(out_img) / f'{qid}-{key}.{ext}'
        sizes += save(arr, p, fmt, quality)
        res['files'][key] = [p.name, arr.shape[1], arr.shape[0]]
    res['bytes'] = sizes
    return res


def parse_answer(raw, kind):
    if raw is None:
        return None if kind == 'mc' else []
    if kind == 'mc':
        return raw.strip()[:1] if raw.strip()[:1] in 'ABCD' else None
    return [a.strip() for a in re.split(r'\s*(?:,|\bor\b)\s*', raw) if a.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf'); ap.add_argument('--out-js', default='js/math.js'); ap.add_argument('--out-img', default='img/math')
    ap.add_argument('--pages', default=None); ap.add_argument('--dpi', type=int, default=144)
    ap.add_argument('--fmt', default='png', choices=['webp', 'png']); ap.add_argument('--quality', type=int, default=72)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()

    total = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', a.pdf], capture_output=True, text=True).stdout).group(1))
    first, last = (1, total) if not a.pages else map(int, a.pages.split('-'))
    print(f'reading layout of pages {first}-{last}…', flush=True)
    pages = read_layout(a.pdf, first, last)
    qs = split_questions(pages)
    print(f'{len(qs)} questions', flush=True)

    jobs = [(a.pdf, q, {n: pages[n] for n in q['pages']}, a.dpi, a.out_img, a.fmt, a.quality) for q in qs]
    results = []
    with ProcessPoolExecutor(a.workers) as ex:
        for i, r in enumerate(ex.map(process, jobs, chunksize=8), 1):
            results.append(r)
            if i % 100 == 0:
                print(f'  {i}/{len(jobs)}', flush=True)

    ok, bad, out = [r for r in results if 'error' not in r], [r for r in results if 'error' in r], []
    for r in ok:
        ans = parse_answer(r['answer_raw'], r['kind'])
        if ans is None or (ans == [] and r['answer_raw']):
            bad.append({'id': r['id'], 'error': f"answer {r['answer_raw']!r}"}); continue
        f = r['files']
        q = {'id': 'M_' + r['id'], 'section': 'math', 'topic': r['domain'], 'subtopic': r['skill'], 'difficulty': r['diff'],
             'points': 1, 'kind': r['kind'], 'img': f['q'], 'answer': ans,
             **({'selfGraded': True} if r['kind'] == 'spr' and not ans else {}),
             'tags': [r['skill'].lower(), r['domain'].lower()]}
        if r['kind'] == 'mc':
            if 'cs' in f:
                q['choicesImg'] = f['cs']
            else:
                q['choiceImgs'] = [f[f'c{i}'] for i in range(4)]
        if 'r' in f:
            q['rationaleImg'] = f['r']
        out.append(q)

    Path(a.out_js).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out_js, 'w') as fh:
        fh.write('/* Math question bank — generated by scripts/build_math.py. Images live in img/math/. Do not edit by hand. */\n')
        fh.write('SAT_QUESTIONS.push(...')
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
        fh.write(');\n')

    mb = sum(r['bytes'] for r in ok) / 1e6
    print(f'\nparsed {len(out)}  rejected {len(bad)}  image total {mb:.1f} MB  avg/question {mb / max(len(ok), 1) * 1000:.0f} KB')
    print('by domain :', dict(Counter(q['topic'] for q in out)))
    print('self-graded (answer only in image):', sum(1 for q in out if q.get('selfGraded')))
    print('kinds     :', dict(Counter(q['kind'] for q in out)), ' difficulty:', dict(Counter(q['difficulty'] for q in out)))
    for b in bad[:20]:
        print('  rejected', b)


if __name__ == '__main__':
    main()
