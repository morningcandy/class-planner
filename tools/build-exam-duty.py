# -*- coding: utf-8 -*-
"""시험감독 엑셀 → exam-duty.js 반영.

고사 기간 아침마다 오는 "시험감독 N일차(m.dd).xlsx"를 받으면 이 스크립트만 돌리면 된다.
같은 날짜를 다시 넣으면(예: -수정본) 그날 항목만 덮어쓰고 다른 날은 그대로 둔다.

    python tools/build-exam-duty.py "2학기 중간고사 시험감독 1일차(10.13)-수정.xlsx" [--name 이서연]

엑셀 구조 전제: 2행 어딘가에 "2026.10.13(화)" 날짜, 교시마다
[학급 | 1..8 | 별도 시험실 | 복도 | 대기실] 머리행 → 학년별로 '정' 행(B=과목, C=학년)과
'부' 행(E=“이름(층), 이름(층)”)이 이어진다. A열에 “1교시” 같은 교시 표기가 있다.
"""
import argparse
import io
import json
import os
import re

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'exam-duty.js')
BEGIN = '/* BEGIN DATA */'
END = '/* END DATA */'


def text(value):
    return '' if value is None else str(value).replace('_x000D_', '').strip()


def parse(path, name):
    sheet = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    rows = [[text(c) for c in row] for row in sheet.iter_rows(values_only=True)]
    date = ''
    for row in rows[:4]:
        for cell in row:
            m = re.search(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})', cell)
            if m:
                date = f'{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}'
    if not date:
        raise SystemExit('날짜(예: 2026.10.13)를 찾지 못했습니다.')

    duties = []
    header = []
    period = 0
    subject = grade = ''
    for row in rows:
        row = row + [''] * (15 - len(row))
        if row[0] == '학급':
            header = row
            continue
        m = re.match(r'(\d)\s*교시', row[0])
        if m:
            period = int(m[1])
        if not period or row[3] not in ('정', '부'):
            continue
        if row[3] == '정':
            subject, grade = row[1], row[2]
            for col in range(4, len(row)):
                # 복도처럼 한 칸에 "박혜미\n김대운"으로 두 명이 들어가기도 한다.
                if name not in re.split(r'[\n,·/]+\s*', row[col]):
                    continue
                place = header[col].replace('\n', '') if col < len(header) else ''
                if place.isdigit():
                    duty = f'{grade} {place}반 정감독'
                elif place.startswith('대기실'):
                    duty = f'{place.replace("(", " (")} 감독'
                else:
                    duty = f'{grade} {place} 감독'
                duties.append({'period': period, 'duty': duty, 'subject': subject})
        else:
            for m2 in re.finditer(r'([가-힣]{2,4})\s*(?:\(([^)]*)\))?', row[4]):
                if m2[1] == name:
                    where = f' ({m2[2]})' if m2[2] else ''
                    duties.append({'period': period, 'duty': f'{grade} 부감독{where}', 'subject': subject})
    return date, duties


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('xlsx')
    parser.add_argument('--name', default='이서연')
    args = parser.parse_args()
    date, duties = parse(args.xlsx, args.name)

    with io.open(OUT, encoding='utf-8') as f:
        source = f.read()
    head, rest = source.split(BEGIN, 1)
    body, tail = rest.split(END, 1)
    data = json.loads(body.strip().removeprefix('window.EXAM_DUTIES =').strip().rstrip(';') or '{}')
    data[date] = duties
    data = dict(sorted(data.items()))
    lines = ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in data.items())
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(f'{head}{BEGIN}\nwindow.EXAM_DUTIES = {{\n{lines}\n}};\n{END}{tail}')

    print(date, f'{args.name} 감독 {len(duties)}건')
    for d in duties:
        print(f"  {d['period']}교시 · {d['duty']} ({d['subject']})")


if __name__ == '__main__':
    main()
