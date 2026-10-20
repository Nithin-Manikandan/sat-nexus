#!/usr/bin/env python3
"""Parse a College Board Question Bank PDF export (Reading & Writing) into js/ela.js.

usage: python3 scripts/parse_ela.py <export.pdf> [--out js/ela.js] [--report report.json]

Needs poppler's `pdftotext`. No AI/OCR: the export has a clean text layer, so parsing is deterministic.
"""
import argparse, json, re, subprocess, sys
from collections import Counter

DOMAINS = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions']
SKILLS = ['Central Ideas and Details', 'Command of Evidence', 'Inferences', 'Words in Context',
          'Text Structure and Purpose', 'Cross-Text Connections', 'Rhetorical Synthesis', 'Transitions',
          'Boundaries', 'Form, Structure, and Sense']
# the app's domain filters (js/app.js) use the ampersand spelling
APP_LABEL = {'Information and Ideas': 'Information & Ideas', 'Craft and Structure': 'Craft & Structure'}
DIFFS = {'Easy': 'easy', 'Medium': 'medium', 'Hard': 'hard'}
FULL_LINE = 128  # wrapped lines are ~140+ chars; anything shorter ends a paragraph


def extract(pdf):
    out = subprocess.run(['pdftotext', '-raw', pdf, '-'], capture_output=True, text=True, check=True).stdout
    return out.replace('\f', '\n')


def fix_text(s):
    s = s.replace(' ', ' ')
    # pdftotext drops the space after a plural-possessive/closing apostrophe: "colleagues’count"
    s = re.sub(r"(?<=s)’(?=[A-Za-z0-9“\"(])(?!s\b)", "’ ", s)
    s = re.sub(r"”(?=[A-Za-z])", "” ", s)  # closing quote glued to next word
    return re.sub(r'[ \t]+', ' ', s).strip()


def paragraphs(lines):
    """Group wrapped lines into paragraphs: a short line ends a paragraph."""
    paras, cur = [], []
    for ln in lines:
        ln = ln.rstrip()
        if not ln:
            continue
        cur.append(ln)
        if len(ln) < FULL_LINE:
            paras.append(' '.join(cur)); cur = []
    if cur:
        paras.append(' '.join(cur))
    return paras


SENT = re.compile(r'(?<=[.?!:”"])\s+(?=[A-Z“"(])')
GOAL = re.compile(r'^(The|A) (student|writer)\b.*\b(want|goal|intend|plan)', re.I)


def split_stem(paras):
    """Return (passage_paras, stem). Falls back to sentence splitting when the passage's last
    line was full-width and the stem got glued onto it."""
    last = paras[-1]
    if len(paras) > 1 and len(last) <= 220:
        return paras[:-1], last
    sents = SENT.split(last)
    if len(sents) == 1:
        return paras[:-1], last
    i = len(sents) - 1
    while i > 0 and GOAL.match(sents[i - 1]):
        i -= 1
    head = ' '.join(sents[:i])
    return (paras[:-1] + [head]) if head else paras[:-1], ' '.join(sents[i:])


def parse_block(block):
    lines = block.split('\n')
    qid = lines[0].strip()
    try:
        hdr = lines.index('Assessment Test Domain Skill Difficulty')
        qi = lines.index('Question', hdr)
        meta = ' '.join(lines[hdr + 1:qi])  # long skill names wrap onto extra lines
        ai = next(i for i in range(qi, len(lines)) if lines[i] == 'Answer')
        ci = next(i for i in range(ai, len(lines)) if lines[i].startswith('Correct Answer:'))
        ri = next(i for i in range(ci, len(lines)) if lines[i] == 'Rationale')
    except (ValueError, StopIteration):
        return None, 'structure'

    low = meta.lower()
    domain = next((d for d in DOMAINS if d.lower() in low), None)
    skill = next((k for k in sorted(SKILLS, key=len, reverse=True) if k.lower() in low), None)
    diff = DIFFS.get(meta.split()[-1])
    if not (domain and skill and diff):
        return None, 'metadata'

    q_paras = paragraphs(lines[qi + 1:ai])
    if not q_paras:
        return None, 'empty question'
    p_paras, stem = split_stem(q_paras)
    passage = '\n\n'.join(p_paras)

    # answer choices: each starts "A. " .. "D. "; continuation lines belong to the previous choice
    choices, cur = [], None
    for ln in lines[ai + 1:ci]:
        m = re.match(r'^([A-D])\. ?(.*)$', ln)
        if m and len(choices) == ord(m.group(1)) - 65:
            cur = [m.group(2)]; choices.append(cur)
        elif cur is not None and ln.strip():
            cur.append(ln.strip())
    if len(choices) != 4:
        return None, f'{len(choices)} choices'
    letters = 'ABCD'
    choices = [f'{letters[i]}) ' + fix_text(' '.join(c)) for i, c in enumerate(choices)]
    answer = lines[ci].split(':')[1].strip()
    if answer not in letters:
        return None, 'answer'

    rationale = fix_text(' '.join(l.strip() for l in lines[ri + 1:]))
    return {
        'id': 'RW_' + qid.split(':')[1].strip(),
        'section': 'reading_writing',
        'topic': APP_LABEL.get(domain, domain),
        'subtopic': skill,
        'difficulty': diff,
        'points': 1,
        **({'passage': '\n\n'.join(fix_text(p) for p in p_paras)} if passage else {}),
        'text': fix_text(stem),
        'choices': choices,
        'answer': answer,
        'explanation': rationale,
        'tags': [skill.lower(), domain.lower()],
    }, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf'); ap.add_argument('--out', default='js/ela.js'); ap.add_argument('--report', default=None)
    a = ap.parse_args()

    raw = extract(a.pdf)
    blocks = re.split(r'(?m)^(?=Question ID:)|(?<=[^\n])(?=Question ID: [0-9a-f]{8}\n)', raw)
    blocks = [b for b in blocks if b.startswith('Question ID:')]
    qs, bad, seen = [], [], set()
    for b in blocks:
        q, err = parse_block(b)
        if err: bad.append((b.split('\n')[0], err)); continue
        if q['id'] in seen: bad.append((q['id'], 'duplicate')); continue
        seen.add(q['id']); qs.append(q)

    with open(a.out, 'w') as f:
        f.write('/* Reading & Writing question bank — generated by scripts/parse_ela.py. Do not edit by hand. */\n')
        f.write('SAT_QUESTIONS.push(...')
        json.dump(qs, f, ensure_ascii=False, separators=(',', ':'))
        f.write(');\n')

    print(f'blocks found: {len(blocks)}  parsed: {len(qs)}  rejected: {len(bad)}')
    print('by domain :', dict(Counter(q['topic'] for q in qs)))
    print('by skill  :', dict(Counter(q['subtopic'] for q in qs)))
    print('difficulty:', dict(Counter(q['difficulty'] for q in qs)))
    print('with passage:', sum('passage' in q for q in qs))
    for b in bad[:15]: print('  rejected', b)
    if a.report: json.dump({'rejected': bad}, open(a.report, 'w'), indent=1)


if __name__ == '__main__':
    main()
